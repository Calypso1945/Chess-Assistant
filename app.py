import os
import json
import chess
import chess.engine
import chess.pgn
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from flask_socketio import SocketIO, emit, join_room, leave_room
from datetime import datetime
import io
import platform
import uuid
import logging

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}})
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='threading')

# Configure logging
logging.basicConfig(level=logging.INFO)

# Store active games
active_games = {}

# Auto-detect Stockfish path in local directory
def find_stockfish_path():
    """
    Find Stockfish executable in the local directory structure
    """
    system = platform.system().lower()
    
    # Get the directory where this script is located
    script_dir = os.path.dirname(os.path.abspath(__file__))
    
    # Stockfish executable names by platform
    if system == "windows":
        exe_names = ["stockfish.exe", "stockfish_15_win_x64_avx2.exe", "stockfish_15_x64_avx2.exe"]
    else:  # Linux/Mac
        exe_names = ["stockfish", "stockfish_15_linux_x64_avx2", "stockfish_15"]
    
    # Search paths relative to script directory
    search_paths = [
        script_dir,  # Same directory as script
        os.path.join(script_dir, "stockfish"),  # stockfish subdirectory
        os.path.join(script_dir, "engines"),    # engines subdirectory
        os.path.join(script_dir, "bin"),        # bin subdirectory
    ]
    
    # Search for Stockfish executable
    for path in search_paths:
        for exe_name in exe_names:
            full_path = os.path.join(path, exe_name)
            if os.path.isfile(full_path):
                # On Unix systems, check if file is executable
                if system != "windows":
                    if os.access(full_path, os.X_OK):
                        print(f"Found Stockfish at: {full_path}")
                        return full_path
                else:
                    print(f"Found Stockfish at: {full_path}")
                    return full_path
    
    return None

# Find Stockfish in local directory
STOCKFISH_PATH = find_stockfish_path()

if not STOCKFISH_PATH:
    print("=" * 60)
    print("WARNING: Stockfish engine not found!")
    print("Please place the Stockfish executable in one of these locations:")
    print(f"1. Same directory as app.py: {os.path.dirname(os.path.abspath(__file__))}")
    print(f"2. In a 'stockfish' subdirectory: {os.path.join(os.path.dirname(os.path.abspath(__file__)), 'stockfish')}")
    if platform.system().lower() == "windows":
        print("   Expected filename: stockfish.exe")
    else:
        print("   Expected filename: stockfish (make sure it's executable)")
    print("Download from: https://stockfishchess.org/download/")
    print("=" * 60)
else:
    print(f"Using Stockfish engine at: {STOCKFISH_PATH}")

engine = None
board = chess.Board()
game_history = []
config = {
    'time': 1.0,
    'threads': 1,
    'memory': 128,  # MB for hash table
    'player_color': 'white',
    'mode': 'suggest'  # 'suggest', 'play', or 'multiplayer'
}

class MultiplayerGame:
    def __init__(self, game_id):
        self.game_id = game_id
        self.board = chess.Board()
        self.players = {'white': None, 'black': None}
        self.spectators = []
        self.history = []
        self.status = 'waiting'  # waiting, active, finished
        
    def add_player(self, player_id, color=None):
        if color and not self.players[color]:
            self.players[color] = player_id
            if self.players['white'] and self.players['black']:
                self.status = 'active'
            return color
        elif not self.players['white']:
            self.players['white'] = player_id
            return 'white'
        elif not self.players['black']:
            self.players['black'] = player_id
            self.status = 'active'
            return 'black'
        else:
            self.spectators.append(player_id)
            return 'spectator'
    
    def remove_player(self, player_id):
        for color, pid in self.players.items():
            if pid == player_id:
                self.players[color] = None
                self.status = 'waiting'
                return
        if player_id in self.spectators:
            self.spectators.remove(player_id)
    
    def get_current_turn(self):
        return 'white' if self.board.turn == chess.WHITE else 'black'
    
    def make_move(self, from_square, to_square, promotion=None):
        try:
            move_uci = from_square + to_square + (promotion.lower() if promotion else '')
            move = chess.Move.from_uci(move_uci)
            
            if move in self.board.legal_moves:
                san = self.board.san(move)
                self.board.push(move)
                self.history.append({
                    'move': san,
                    'fen': self.board.fen(),
                    'from': from_square,
                    'to': to_square
                })
                
                if self.board.is_game_over():
                    self.status = 'finished'
                
                return True
            return False
        except:
            return False
    
    def get_state(self):
        return {
            'game_id': self.game_id,
            'fen': self.board.fen(),
            'players': self.players,
            'current_turn': self.get_current_turn(),
            'status': self.status,
            'history': self.get_move_history(),
            'game_over': self.board.is_game_over(),
            'result': self.board.result() if self.board.is_game_over() else None
        }
    
    def get_move_history(self):
        moves = []
        for i in range(0, len(self.history), 2):
            move_num = i // 2 + 1
            white_move = self.history[i]['move'] if i < len(self.history) else ''
            black_move = self.history[i + 1]['move'] if i + 1 < len(self.history) else ''
            moves.append({
                'number': move_num,
                'white': white_move,
                'black': black_move
            })
        return moves

def init_engine():
    global engine
    try:
        if not STOCKFISH_PATH:
            print("Cannot initialize engine: Stockfish not found")
            return False
            
        if engine:
            engine.quit()
        engine = chess.engine.SimpleEngine.popen_uci(STOCKFISH_PATH)
        # Configure engine with current settings
        engine.configure({
            "Threads": config['threads'],
            "Hash": config['memory']
        })
        print(f"Engine initialized successfully with {STOCKFISH_PATH}")
        return True
    except Exception as e:
        print(f"Error initializing engine: {e}")
        return False

# Serve static files (HTML, CSS, JS)
@app.route('/')
def index():
    return send_from_directory('.', 'index.html')

@app.route('/styles.css')
def styles():
    return send_from_directory('.', 'styles.css')

@app.route('/script.js')
def script():
    return send_from_directory('.', 'script.js')

# WebSocket events for multiplayer
@socketio.on('connect')
def handle_connect():
    print(f'Client connected: {request.sid}')
    emit('connected', {'player_id': request.sid})

@socketio.on('disconnect')
def handle_disconnect():
    print(f'Client disconnected: {request.sid}')
    # Remove player from any active games
    for game_id, game in list(active_games.items()):
        game.remove_player(request.sid)
        if game.status == 'waiting':
            socketio.emit('player_left', game.get_state(), room=game_id)
        if not game.players['white'] and not game.players['black'] and not game.spectators:
            del active_games[game_id]
            print(f'Game {game_id} deleted - no players')

@socketio.on('create_game')
def handle_create_game(data):
    game_id = str(uuid.uuid4())[:8]
    game = MultiplayerGame(game_id)
    active_games[game_id] = game
    
    color = data.get('color', None)
    assigned_color = game.add_player(request.sid, color)
    
    join_room(game_id)
    emit('game_created', {
        'game_id': game_id,
        'color': assigned_color,
        'state': game.get_state()
    })
    print(f'Game created: {game_id}')

@socketio.on('join_game')
def handle_join_game(data):
    game_id = data['game_id']
    if game_id not in active_games:
        emit('error', {'message': 'Game not found'})
        return
    
    game = active_games[game_id]
    color = data.get('color', None)
    assigned_color = game.add_player(request.sid, color)
    
    join_room(game_id)
    emit('game_joined', {
        'game_id': game_id,
        'color': assigned_color,
        'state': game.get_state()
    })
    
    # Notify all players in the room
    socketio.emit('player_joined', game.get_state(), room=game_id)
    print(f'Player {request.sid} joined game {game_id} as {assigned_color}')

@socketio.on('make_multiplayer_move')
def handle_multiplayer_move(data):
    game_id = data['game_id']
    if game_id not in active_games:
        emit('error', {'message': 'Game not found'})
        return
    
    game = active_games[game_id]
    
    # Verify it's the player's turn
    current_turn = game.get_current_turn()
    if game.players[current_turn] != request.sid:
        emit('error', {'message': 'Not your turn'})
        return
    
    # Make the move
    success = game.make_move(data['from'], data['to'], data.get('promotion'))
    
    if success:
        state = game.get_state()
        socketio.emit('move_made', state, room=game_id)
        
        # Play sound notification for the opponent
        socketio.emit('play_sound', {'sound': 'move'}, room=game_id, skip_sid=request.sid)
    else:
        emit('error', {'message': 'Invalid move'})

@socketio.on('get_game_state')
def handle_get_game_state(data):
    game_id = data['game_id']
    if game_id not in active_games:
        emit('error', {'message': 'Game not found'})
        return
    
    game = active_games[game_id]
    emit('game_state', game.get_state())

@socketio.on('leave_game')
def handle_leave_game(data):
    game_id = data['game_id']
    if game_id in active_games:
        game = active_games[game_id]
        game.remove_player(request.sid)
        leave_room(game_id)
        socketio.emit('player_left', game.get_state(), room=game_id)
        print(f'Player {request.sid} left game {game_id}')

# Single player endpoints (unchanged)
@app.route('/api/init', methods=['POST'])
def initialize():
    success = init_engine()
    if not success and not STOCKFISH_PATH:
        return jsonify({
            'success': False,
            'error': 'Stockfish engine not found. Please install Stockfish and ensure it is accessible.',
            'fen': board.fen(),
            'config': config
        })
    return jsonify({
        'success': success,
        'fen': board.fen(),
        'config': config
    })

@app.route('/api/config', methods=['POST'])
def set_config():
    global config, engine
    data = request.json
    config.update(data)
    
    # Update engine configuration if threads or memory changed
    if engine and ('threads' in data or 'memory' in data):
        engine.configure({
            "Threads": config['threads'],
            "Hash": config['memory']
        })
    
    return jsonify({'success': True, 'config': config})

@app.route('/api/move', methods=['POST'])
def make_move():
    global board, game_history
    data = request.json
    
    try:
        # Parse move
        from_square = data.get('from')
        to_square = data.get('to')
        promotion = data.get('promotion')
        
        # Create move
        move_uci = from_square + to_square + (promotion.lower() if promotion else '')
        move = chess.Move.from_uci(move_uci)
        
        # Validate move
        if move in board.legal_moves:
            # Record move in algebraic notation
            san = board.san(move)
            board.push(move)
            game_history.append({
                'move': san,
                'fen': board.fen(),
                'from': from_square,
                'to': to_square
            })
            
            # Get computer move if in play mode
            computer_move = None
            if config['mode'] == 'play' and not board.is_game_over():
                is_computer_turn = (board.turn == chess.WHITE and config['player_color'] == 'black') or \
                                 (board.turn == chess.BLACK and config['player_color'] == 'white')
                if is_computer_turn:
                    computer_move = get_best_move()
                    if computer_move:
                        san = board.san(computer_move['move'])
                        board.push(computer_move['move'])
                        game_history.append({
                            'move': san,
                            'fen': board.fen(),
                            'from': computer_move['from'],
                            'to': computer_move['to']
                        })
            
            return jsonify({
                'success': True,
                'fen': board.fen(),
                'move_history': get_move_history(),
                'computer_move': computer_move,
                'game_over': board.is_game_over(),
                'result': board.result() if board.is_game_over() else None
            })
        else:
            return jsonify({'success': False, 'error': 'Illegal move'}), 400
            
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 400

@app.route('/api/suggest', methods=['POST'])
def suggest_move():
    best_move = get_best_move()
    return jsonify({
        'success': True if best_move else False,
        'suggestion': best_move
    })

@app.route('/api/fen', methods=['GET', 'POST'])
def handle_fen():
    global board, game_history
    
    if request.method == 'GET':
        return jsonify({'fen': board.fen()})
    else:
        data = request.json
        fen = data.get('fen')
        try:
            board = chess.Board(fen)
            game_history = []  # Reset history when loading new position
            return jsonify({'success': True, 'fen': board.fen()})
        except Exception as e:
            return jsonify({'success': False, 'error': f'Invalid FEN: {str(e)}'}), 400

@app.route('/api/reset', methods=['POST'])
def reset_game():
    global board, game_history
    board = chess.Board()
    game_history = []
    return jsonify({
        'success': True,
        'fen': board.fen(),
        'move_history': []
    })

@app.route('/api/undo', methods=['POST'])
def undo_move():
    global board, game_history
    
    if board.move_stack:
        board.pop()
        if game_history:
            game_history.pop()
        
        # If in play mode and it's computer's turn, undo computer's move too
        if config['mode'] == 'play' and board.move_stack:
            is_computer_turn = (board.turn == chess.WHITE and config['player_color'] == 'black') or \
                             (board.turn == chess.BLACK and config['player_color'] == 'white')
            if is_computer_turn:
                board.pop()
                if game_history:
                    game_history.pop()
        
        return jsonify({
            'success': True,
            'fen': board.fen(),
            'move_history': get_move_history()
        })
    else:
        return jsonify({'success': False, 'error': 'No moves to undo'}), 400

@app.route('/api/save', methods=['POST'])
def save_game():
    data = request.json
    format_type = data.get('format', 'pgn')
    
    if format_type == 'pgn':
        game = chess.pgn.Game()
        game.headers["Event"] = "Chess Assistant Game"
        game.headers["Date"] = datetime.now().strftime("%Y.%m.%d")
        game.headers["White"] = "Player" if config['player_color'] == 'white' else "Computer"
        game.headers["Black"] = "Computer" if config['player_color'] == 'white' else "Player"
        
        node = game
        temp_board = chess.Board()
        for move in board.move_stack:
            node = node.add_variation(move)
            temp_board.push(move)
        
        pgn_string = str(game)
        return jsonify({
            'success': True,
            'data': pgn_string,
            'filename': f"game_{datetime.now().strftime('%Y%m%d_%H%M%S')}.pgn"
        })
    else:
        return jsonify({
            'success': True,
            'data': board.fen(),
            'filename': f"position_{datetime.now().strftime('%Y%m%d_%H%M%S')}.fen"
        })

@app.route('/api/load', methods=['POST'])
def load_game():
    global board, game_history
    data = request.json
    content = data.get('content')
    format_type = data.get('format', 'pgn')
    
    try:
        if format_type == 'pgn':
            pgn = io.StringIO(content)
            game = chess.pgn.read_game(pgn)
            if game:
                board = game.board()
                for move in game.mainline_moves():
                    board.push(move)
                game_history = []  # Reset history
            else:
                return jsonify({'success': False, 'error': 'Could not parse PGN'}), 400
        else:
            board = chess.Board(content)
            game_history = []
        
        return jsonify({
            'success': True,
            'fen': board.fen()
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 400

@app.route('/api/legal_moves', methods=['POST'])
def get_legal_moves():
    data = request.json
    square = data.get('square')
    
    if square:
        try:
            square_obj = chess.parse_square(square)
            legal_moves = [move.uci() for move in board.legal_moves if move.from_square == square_obj]
            return jsonify({
                'success': True,
                'moves': legal_moves
            })
        except ValueError:
            return jsonify({'success': False, 'error': 'Invalid square'}), 400
    else:
        return jsonify({
            'success': True,
            'moves': [move.uci() for move in board.legal_moves]
        })

@app.route('/api/active_games', methods=['GET'])
def get_active_games():
    games_list = []
    for game_id, game in active_games.items():
        games_list.append({
            'game_id': game_id,
            'status': game.status,
            'players': game.players,
            'spectators_count': len(game.spectators)
        })
    return jsonify({'games': games_list})

def get_best_move():
    if not engine:
        return None
    
    try:
        result = engine.play(
            board, 
            chess.engine.Limit(time=config['time'])
        )
        
        if result.move:
            return {
                'move': result.move,
                'from': chess.square_name(result.move.from_square),
                'to': chess.square_name(result.move.to_square),
                'uci': result.move.uci()
            }
    except Exception as e:
        print(f"Engine error: {e}")
        return None

def get_move_history():
    moves = []
    for i in range(0, len(game_history), 2):
        move_num = i // 2 + 1
        white_move = game_history[i]['move'] if i < len(game_history) else ''
        black_move = game_history[i + 1]['move'] if i + 1 < len(game_history) else ''
        moves.append({
            'number': move_num,
            'white': white_move,
            'black': black_move
        })
    return moves

# Cleanup function to properly close engine
def cleanup():
    global engine
    if engine:
        engine.quit()

# Register cleanup function
import atexit
atexit.register(cleanup)

if __name__ == '__main__':
    init_engine()
    try:
        # Run with SocketIO
        socketio.run(app, debug=True, host='0.0.0.0', port=5000)
    finally:
        cleanup()
