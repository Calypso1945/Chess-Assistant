const API_URL = 'http://localhost:5000/api';
const SOCKET_URL = 'http://localhost:5000';
let socket = null;
let board = null;
let currentFEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
let selectedSquare = null;
let legalMoves = [];
let playerColor = 'white';
let gameMode = 'suggest';
let draggedPiece = null;
let draggedFrom = null;
let preventIllegalMoves = true;
let lastSuggestion = null;

// Multiplayer variables
let multiplayerGame = null;
let multiplayerColor = null;
let playerId = null;

const pieceUnicode = {
    'K': '♔', 'Q': '♕', 'R': '♖', 'B': '♗', 'N': '♘', 'P': '♙',
    'k': '♚', 'q': '♛', 'r': '♜', 'b': '♝', 'n': '♞', 'p': '♟'
};

// Sound system
const soundManager = {
    enabled: true,
    volume: 0.7,
    sounds: {},
    
    // Initialize all sounds
    init() {
        // Create audio context for web audio API
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        
        // Define sound frequencies and patterns
        this.soundDefinitions = {
            move: { frequency: 800, duration: 0.1, type: 'sine' },
            capture: { frequency: 600, duration: 0.15, type: 'square' },
            check: { frequency: 1000, duration: 0.2, type: 'sawtooth' },
            checkmate: { frequency: 400, duration: 0.5, type: 'triangle' },
            castle: { frequency: 700, duration: 0.2, type: 'sine' },
            promotion: { frequency: 1200, duration: 0.3, type: 'sine' },
            gameStart: { frequency: 880, duration: 0.2, type: 'sine' },
            gameEnd: { frequency: 440, duration: 0.4, type: 'sine' },
            button: { frequency: 900, duration: 0.05, type: 'sine' },
            error: { frequency: 300, duration: 0.2, type: 'square' },
            playerJoin: { frequency: 1000, duration: 0.15, type: 'sine' }
        };
        
        console.log('Sound system initialized');
    },
    
    // Generate and play a sound
    playSound(soundName) {
        if (!this.enabled || this.volume === 0) return;
        
        const soundDef = this.soundDefinitions[soundName];
        if (!soundDef) return;
        
        try {
            // Resume audio context if suspended (required for some browsers)
            if (this.audioContext.state === 'suspended') {
                this.audioContext.resume();
            }
            
            const oscillator = this.audioContext.createOscillator();
            const gainNode = this.audioContext.createGain();
            
            oscillator.connect(gainNode);
            gainNode.connect(this.audioContext.destination);
            
            oscillator.frequency.setValueAtTime(soundDef.frequency, this.audioContext.currentTime);
            oscillator.type = soundDef.type;
            
            // Set volume envelope
            gainNode.gain.setValueAtTime(0, this.audioContext.currentTime);
            gainNode.gain.linearRampToValueAtTime(this.volume * 0.3, this.audioContext.currentTime + 0.01);
            gainNode.gain.exponentialRampToValueAtTime(0.001, this.audioContext.currentTime + soundDef.duration);
            
            oscillator.start(this.audioContext.currentTime);
            oscillator.stop(this.audioContext.currentTime + soundDef.duration);
            
        } catch (error) {
            console.warn('Error playing sound:', error);
        }
    },
    
    // Special multi-tone sounds
    playComplexSound(soundName) {
        if (!this.enabled || this.volume === 0) return;
        
        switch(soundName) {
            case 'promotion':
                // Play ascending notes
                setTimeout(() => this.playSound('promotion'), 0);
                setTimeout(() => this.playFrequency(1400, 0.1, 'sine'), 100);
                setTimeout(() => this.playFrequency(1600, 0.1, 'sine'), 200);
                break;
                
            case 'checkmate':
                // Play dramatic descending sequence
                this.playFrequency(800, 0.15, 'triangle');
                setTimeout(() => this.playFrequency(600, 0.15, 'triangle'), 150);
                setTimeout(() => this.playFrequency(400, 0.3, 'triangle'), 300);
                break;
                
            case 'castle':
                // Play two quick notes
                this.playFrequency(700, 0.1, 'sine');
                setTimeout(() => this.playFrequency(900, 0.1, 'sine'), 100);
                break;
                
            default:
                this.playSound(soundName);
        }
    },
    
    // Play a specific frequency
    playFrequency(frequency, duration, type) {
        if (!this.enabled || this.volume === 0) return;
        
        try {
            if (this.audioContext.state === 'suspended') {
                this.audioContext.resume();
            }
            
            const oscillator = this.audioContext.createOscillator();
            const gainNode = this.audioContext.createGain();
            
            oscillator.connect(gainNode);
            gainNode.connect(this.audioContext.destination);
            
            oscillator.frequency.setValueAtTime(frequency, this.audioContext.currentTime);
            oscillator.type = type;
            
            gainNode.gain.setValueAtTime(0, this.audioContext.currentTime);
            gainNode.gain.linearRampToValueAtTime(this.volume * 0.3, this.audioContext.currentTime + 0.01);
            gainNode.gain.exponentialRampToValueAtTime(0.001, this.audioContext.currentTime + duration);
            
            oscillator.start(this.audioContext.currentTime);
            oscillator.stop(this.audioContext.currentTime + duration);
            
        } catch (error) {
            console.warn('Error playing frequency:', error);
        }
    },
    
    // Set volume (0-1)
    setVolume(volume) {
        this.volume = Math.max(0, Math.min(1, volume));
    },
    
    // Toggle sound on/off
    toggle() {
        this.enabled = !this.enabled;
        return this.enabled;
    }
};

// Initialize WebSocket connection
function initializeSocket() {
    socket = io(SOCKET_URL);
    
    socket.on('connect', () => {
        console.log('Connected to server');
    });
    
    socket.on('connected', (data) => {
        playerId = data.player_id;
        console.log('Player ID:', playerId);
    });
    
    socket.on('game_created', (data) => {
        multiplayerGame = data.state;
        multiplayerColor = data.color;
        showGameLink(data.game_id);
        updateMultiplayerInfo();
        updateStatus(`Game created! You are playing as ${data.color}`, 'success');
        soundManager.playSound('gameStart');
    });
    
    socket.on('game_joined', (data) => {
        multiplayerGame = data.state;
        multiplayerColor = data.color;
        currentFEN = data.state.fen;
        renderBoard();
        updateMoveHistory(data.state.history);
        showGameLink(data.game_id);
        updateMultiplayerInfo();
        updateStatus(`Joined game! You are playing as ${data.color}`, 'success');
        soundManager.playSound('playerJoin');
    });
    
    socket.on('player_joined', (state) => {
        multiplayerGame = state;
        updateMultiplayerInfo();
        if (state.status === 'active') {
            updateStatus('Opponent joined! Game is starting.', 'success');
            soundManager.playSound('playerJoin');
        }
    });
    
    socket.on('player_left', (state) => {
        multiplayerGame = state;
        updateMultiplayerInfo();
        updateStatus('Opponent left the game', 'error');
    });
    
    socket.on('move_made', (state) => {
        multiplayerGame = state;
        currentFEN = state.fen;
        renderBoard();
        updateMoveHistory(state.history);
        updateMultiplayerInfo();
        
        if (state.game_over) {
            updateStatus(`Game Over! Result: ${state.result}`, 'success');
            if (state.result.includes('checkmate')) {
                soundManager.playComplexSound('checkmate');
            } else {
                soundManager.playSound('gameEnd');
            }
        }
    });
    
    socket.on('play_sound', (data) => {
        soundManager.playSound(data.sound);
    });
    
    socket.on('error', (data) => {
        updateStatus(data.message, 'error');
        soundManager.playSound('error');
    });
}

// Initialize the application
async function init() {
    try {
        // Initialize sound system
        soundManager.init();
        
        // Initialize WebSocket
        initializeSocket();
        
        const response = await fetch(`${API_URL}/init`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        const data = await response.json();
        
        if (data.success) {
            currentFEN = data.fen;
            renderBoard();
            updateStatus('Engine initialized successfully', 'success');
            soundManager.playSound('gameStart');
            fetchActiveGames();
        } else {
            updateStatus('Failed to initialize engine', 'error');
            soundManager.playSound('error');
        }
    } catch (error) {
        updateStatus('Error connecting to server: ' + error.message, 'error');
        soundManager.playSound('error');
    }
}

// Render the chess board
function renderBoard() {
    const boardElement = document.getElementById('board');
    boardElement.innerHTML = '';
    
    const [position, turn, castling, enPassant, halfmove, fullmove] = parseFEN(currentFEN);
    const isFlipped = (gameMode === 'multiplayer' ? multiplayerColor : playerColor) === 'black';
    
    for (let row = 0; row < 8; row++) {
        for (let col = 0; col < 8; col++) {
            const displayRow = isFlipped ? 7 - row : row;
            const displayCol = isFlipped ? 7 - col : col;
            
            const square = document.createElement('div');
            const squareId = String.fromCharCode(97 + col) + (8 - row);
            square.className = 'square ' + ((row + col) % 2 === 0 ? 'light' : 'dark');
            square.dataset.square = squareId;
            square.style.gridRow = displayRow + 1;
            square.style.gridColumn = displayCol + 1;
            
            const piece = position[row][col];
            if (piece) {
                const pieceElement = document.createElement('span');
                const isWhitePiece = piece === piece.toUpperCase();
                pieceElement.className = `piece ${isWhitePiece ? 'black' : 'white'}`;
                pieceElement.textContent = pieceUnicode[piece];
                pieceElement.draggable = true;
                pieceElement.dataset.piece = piece;
                pieceElement.dataset.square = squareId;
                
                // Drag events
                pieceElement.addEventListener('dragstart', handleDragStart);
                pieceElement.addEventListener('dragend', handleDragEnd);
                
                square.appendChild(pieceElement);
            }
            
            // Drop events
            square.addEventListener('dragover', handleDragOver);
            square.addEventListener('drop', handleDrop);
            square.addEventListener('click', handleSquareClick);
            
            // Add coordinate labels
            if (col === 0) {
                const rankLabel = document.createElement('div');
                rankLabel.className = 'coordinates rank-label';
                rankLabel.textContent = 8 - row;
                square.appendChild(rankLabel);
            }
            if (row === 7) {
                const fileLabel = document.createElement('div');
                fileLabel.className = 'coordinates file-label';
                fileLabel.textContent = String.fromCharCode(97 + col);
                square.appendChild(fileLabel);
            }
            
            boardElement.appendChild(square);
        }
    }
    
    highlightLastSuggestion();
}

// Parse FEN string
function parseFEN(fen) {
    const parts = fen.split(' ');
    const position = [];
    const rows = parts[0].split('/');
    
    for (const row of rows) {
        const parsedRow = [];
        for (const char of row) {
            if (isNaN(char)) {
                parsedRow.push(char);
            } else {
                for (let i = 0; i < parseInt(char); i++) {
                    parsedRow.push(null);
                }
            }
        }
        position.push(parsedRow);
    }
    
    return [position, ...parts.slice(1)];
}

// Handle piece drag start
function handleDragStart(e) {
    // In multiplayer mode, check if it's the player's turn
    if (gameMode === 'multiplayer') {
        if (!canMakeMove()) {
            e.preventDefault();
            return;
        }
    }
    
    draggedPiece = e.target;
    draggedFrom = e.target.dataset.square;
    e.target.classList.add('dragging');
    
    if (preventIllegalMoves) {
        fetchLegalMoves(draggedFrom);
    }
}

// Handle piece drag end
function handleDragEnd(e) {
    e.target.classList.remove('dragging');
    clearHighlights();
}

// Handle drag over
function handleDragOver(e) {
    e.preventDefault();
}

// Handle piece drop
async function handleDrop(e) {
    e.preventDefault();
    const toSquare = e.currentTarget.dataset.square;
    
    if (draggedFrom && toSquare && draggedFrom !== toSquare) {
        await makeMove(draggedFrom, toSquare);
    }
    
    draggedPiece = null;
    draggedFrom = null;
}

// Handle square click (for click-to-move)
async function handleSquareClick(e) {
    // In multiplayer mode, check if it's the player's turn
    if (gameMode === 'multiplayer' && !canMakeMove()) {
        return;
    }
    
    const square = e.currentTarget.dataset.square;
    const piece = e.currentTarget.querySelector('.piece');
    
    if (selectedSquare) {
        if (square !== selectedSquare) {
            await makeMove(selectedSquare, square);
        }
        clearHighlights();
        selectedSquare = null;
    } else if (piece) {
        selectedSquare = square;
        e.currentTarget.classList.add('highlight');
        if (preventIllegalMoves) {
            fetchLegalMoves(square);
        }
    }
}

// Check if player can make a move in multiplayer
function canMakeMove() {
    if (!multiplayerGame || multiplayerGame.status !== 'active') {
        return false;
    }
    
    return multiplayerGame.current_turn === multiplayerColor;
}

// Fetch legal moves for a piece
async function fetchLegalMoves(square) {
    try {
        const response = await fetch(`${API_URL}/legal_moves`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ square })
        });
        const data = await response.json();
        
        if (data.success) {
            legalMoves = data.moves;
            highlightLegalMoves();
        }
    } catch (error) {
        console.error('Error fetching legal moves:', error);
    }
}

// Highlight legal moves
function highlightLegalMoves() {
    clearHighlights();
    legalMoves.forEach(move => {
        const toSquare = move.substring(2, 4);
        const squareElement = document.querySelector(`[data-square="${toSquare}"]`);
        if (squareElement) {
            squareElement.classList.add('legal-move');
        }
    });
}

// Clear all highlights
function clearHighlights() {
    document.querySelectorAll('.square').forEach(square => {
        square.classList.remove('highlight', 'legal-move', 'suggestion-from', 'suggestion-to');
    });
}

// Make a move
async function makeMove(from, to, promotion = null) {
    // Check for pawn promotion
    const piece = document.querySelector(`[data-square="${from}"] .piece`);
    if (piece && piece.dataset.piece.toLowerCase() === 'p') {
        const fromRank = parseInt(from[1]);
        const toRank = parseInt(to[1]);
        if ((piece.dataset.piece === 'P' && toRank === 8) || 
            (piece.dataset.piece === 'p' && toRank === 1)) {
            if (!promotion) {
                showPromotionDialog(from, to);
                return;
            }
        }
    }

    // Check if it's a capture move
    const targetSquare = document.querySelector(`[data-square="${to}"]`);
    const isCapture = targetSquare && targetSquare.querySelector('.piece');
    
    // Check for castling
    const isCastling = piece && piece.dataset.piece.toLowerCase() === 'k' && 
                      Math.abs(from.charCodeAt(0) - to.charCodeAt(0)) === 2;

    // Handle multiplayer move
    if (gameMode === 'multiplayer') {
        socket.emit('make_multiplayer_move', {
            game_id: multiplayerGame.game_id,
            from,
            to,
            promotion
        });
        return;
    }

    // Handle single player move
    try {
        const response = await fetch(`${API_URL}/move`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ from, to, promotion })
        });
        const data = await response.json();
        
        if (data.success) {
            currentFEN = data.fen;
            renderBoard();
            updateMoveHistory(data.move_history);
            
            // Play appropriate sound
            if (promotion) {
                soundManager.playComplexSound('promotion');
            } else if (isCastling) {
                soundManager.playComplexSound('castle');
            } else if (isCapture) {
                soundManager.playSound('capture');
            } else {
                soundManager.playSound('move');
            }
            
            if (data.computer_move) {
                setTimeout(() => {
                    currentFEN = data.fen;
                    renderBoard();
                    updateMoveHistory(data.move_history);
                    // Play sound for computer move
                    soundManager.playSound('move');
                }, 100);
            }
            
            if (data.game_over) {
                updateStatus(`Game Over! Result: ${data.result}`, 'success');
                if (data.result.includes('checkmate')) {
                    soundManager.playComplexSound('checkmate');
                } else {
                    soundManager.playSound('gameEnd');
                }
            } else {
                // Check if the move resulted in check
                if (data.in_check) {
                    soundManager.playSound('check');
                }
                updateStatus('Move made successfully', 'success');
            }
            
            lastSuggestion = null;
        } else {
            updateStatus(data.error || 'Invalid move', 'error');
            soundManager.playSound('error');
        }
    } catch (error) {
        updateStatus('Error making move: ' + error.message, 'error');
        soundManager.playSound('error');
    }
}

// Show promotion dialog
function showPromotionDialog(from, to) {
    const dialog = document.getElementById('promotionDialog');
    const fromSquareEl = document.querySelector(`[data-square="${from}"]`);
    const rect = fromSquareEl.getBoundingClientRect();
    
    dialog.style.display = 'flex';
    dialog.style.left = rect.left + 'px';
    dialog.style.top = rect.top + 'px';
    
    dialog.querySelectorAll('.piece').forEach(piece => {
        piece.onclick = () => {
            dialog.style.display = 'none';
            makeMove(from, to, piece.dataset.piece);
        };
    });
}

// Multiplayer functions
function createMultiplayerGame() {
    const color = document.getElementById('playerColor').value;
    socket.emit('create_game', { color });
}

function joinMultiplayerGame() {
    const gameId = document.getElementById('gameIdInput').value.trim();
    if (!gameId) {
        updateStatus('Please enter a game ID', 'error');
        return;
    }
    
    socket.emit('join_game', { game_id: gameId });
}

function leaveMultiplayerGame() {
    if (multiplayerGame) {
        socket.emit('leave_game', { game_id: multiplayerGame.game_id });
        multiplayerGame = null;
        multiplayerColor = null;
        document.getElementById('gameLink').style.display = 'none';
        document.getElementById('multiplayerInfo').innerHTML = '';
        updateStatus('Left the game', 'success');
        
        // Reset to single player
        resetGame();
    }
}

function showGameLink(gameId) {
    document.getElementById('gameLink').style.display = 'block';
    document.getElementById('gameLinkText').value = gameId;
}

function copyGameId() {
    const gameLinkText = document.getElementById('gameLinkText');
    gameLinkText.select();
    document.execCommand('copy');
    updateStatus('Game ID copied to clipboard!', 'success');
}

function updateMultiplayerInfo() {
    if (!multiplayerGame) return;
    
    const infoEl = document.getElementById('multiplayerInfo');
    const whitePlayer = multiplayerGame.players.white ? 'Connected' : 'Waiting...';
    const blackPlayer = multiplayerGame.players.black ? 'Connected' : 'Waiting...';
    const currentTurn = multiplayerGame.current_turn;
    const isYourTurn = currentTurn === multiplayerColor;
    
    infoEl.innerHTML = `
        <div class="multiplayer-status">
            <div>White: ${whitePlayer}</div>
            <div>Black: ${blackPlayer}</div>
            <div class="turn-indicator ${isYourTurn ? 'your-turn' : ''}">
                ${isYourTurn ? 'Your turn' : `${currentTurn}'s turn`}
            </div>
        </div>
    `;
}

async function fetchActiveGames() {
    try {
        const response = await fetch(`${API_URL}/active_games`);
        const data = await response.json();
        
        const activeGamesEl = document.getElementById('activeGames');
        if (data.games.length > 0) {
            activeGamesEl.innerHTML = '<h4>Active Games:</h4>';
            data.games.forEach(game => {
                const gameEl = document.createElement('div');
                gameEl.className = 'active-game-item';
                gameEl.innerHTML = `
                    <span>Game ${game.game_id} - ${game.status}</span>
                    <button class="button secondary small" onclick="document.getElementById('gameIdInput').value='${game.game_id}'; joinMultiplayerGame()">Join</button>
                `;
                activeGamesEl.appendChild(gameEl);
            });
        } else {
            activeGamesEl.innerHTML = '<p>No active games</p>';
        }
    } catch (error) {
        console.error('Error fetching active games:', error);
    }
}

function handleGameModeChange() {
    const mode = document.getElementById('gameMode').value;
    gameMode = mode;
    
    const multiplayerPanel = document.getElementById('multiplayerPanel');
    const suggestButton = document.getElementById('suggestButton');
    
    if (mode === 'multiplayer') {
        multiplayerPanel.style.display = 'block';
        suggestButton.style.display = 'none';
        fetchActiveGames();
    } else {
        multiplayerPanel.style.display = 'none';
        suggestButton.style.display = 'inline-block';
        
        // Leave any active multiplayer game
        if (multiplayerGame) {
            leaveMultiplayerGame();
        }
    }
    
    updateConfig();
}

// Suggest best move
async function suggestMove() {
    try {
        updateStatus('Calculating best move...', '');
        const response = await fetch(`${API_URL}/suggest`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        const data = await response.json();
        
        if (data.success && data.suggestion) {
            lastSuggestion = data.suggestion;
            highlightLastSuggestion();
            updateStatus(`Best move: ${data.suggestion.from} to ${data.suggestion.to}`, 'success');
        } else {
            updateStatus('No suggestion available', 'error');
        }
    } catch (error) {
        updateStatus('Error getting suggestion: ' + error.message, 'error');
    }
}

// Highlight last suggestion
function highlightLastSuggestion() {
    if (lastSuggestion) {
        const fromSquare = document.querySelector(`[data-square="${lastSuggestion.from}"]`);
        const toSquare = document.querySelector(`[data-square="${lastSuggestion.to}"]`);
        if (fromSquare) fromSquare.classList.add('suggestion-from');
        if (toSquare) toSquare.classList.add('suggestion-to');
    }
}

// Update move history display
function updateMoveHistory(history) {
    const historyElement = document.getElementById('moveHistory');
    historyElement.innerHTML = '';
    
    history.forEach(move => {
        const row = document.createElement('div');
        row.className = 'move-row';
        row.innerHTML = `
            <div class="move-number">${move.number}.</div>
            <div class="move-white">${move.white}</div>
            <div class="move-black">${move.black}</div>
        `;
        historyElement.appendChild(row);
    });
    
    historyElement.scrollTop = historyElement.scrollHeight;
}

// Update status message
function updateStatus(message, type = '') {
    const statusElement = document.getElementById('status');
    statusElement.textContent = message;
    statusElement.className = 'status-bar ' + type;
    
    if (type) {
        setTimeout(() => {
            statusElement.className = 'status-bar';
        }, 3000);
    }
}

// New game
async function newGame() {
    playerColor = document.getElementById('playerColor').value;
    gameMode = document.getElementById('gameMode').value;
    
    await updateConfig();
    await resetGame();
    
    // Re-render board with new orientation
    renderBoard();
    
    // Play game start sound
    soundManager.playSound('gameStart');
    
    // If playing as black, make computer move
    if (gameMode === 'play' && playerColor === 'black') {
        setTimeout(suggestMove, 500);
    }
}

// Update configuration
async function updateConfig() {
    const config = {
        player_color: document.getElementById('playerColor').value,
        mode: document.getElementById('gameMode').value,
        time: parseFloat(document.getElementById('time').value),
        threads: parseInt(document.getElementById('threads').value),
        memory: parseInt(document.getElementById('memory').value)
    };
    
    try {
        await fetch(`${API_URL}/config`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(config)
        });
        playerColor = config.player_color;
        gameMode = config.mode;
    } catch (error) {
        updateStatus('Error updating configuration', 'error');
    }
}

// Update engine settings
async function updateEngineSettings() {
    await updateConfig();
    updateStatus('Engine settings updated', 'success');
}

// Reset game
async function resetGame() {
    try {
        const response = await fetch(`${API_URL}/reset`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        const data = await response.json();
        
        if (data.success) {
            currentFEN = data.fen;
            renderBoard();
            updateMoveHistory([]);
            updateStatus('Game reset', 'success');
            lastSuggestion = null;
        }
    } catch (error) {
        updateStatus('Error resetting game', 'error');
    }
}

// Undo move
async function undoMove() {
    if (gameMode === 'multiplayer') {
        updateStatus('Cannot undo moves in multiplayer mode', 'error');
        return;
    }
    
    try {
        const response = await fetch(`${API_URL}/undo`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        const data = await response.json();
        
        if (data.success) {
            currentFEN = data.fen;
            renderBoard();
            updateMoveHistory(data.move_history);
            updateStatus('Move undone', 'success');
            lastSuggestion = null;
        } else {
            updateStatus(data.error || 'Cannot undo', 'error');
        }
    } catch (error) {
        updateStatus('Error undoing move', 'error');
    }
}

// Load FEN position
async function loadFEN() {
    const fenInput = document.getElementById('fenInput').value.trim();
    if (!fenInput) {
        updateStatus('Please enter a FEN string', 'error');
        return;
    }
    
    try {
        const response = await fetch(`${API_URL}/fen`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fen: fenInput })
        });
        const data = await response.json();
        
        if (data.success) {
            currentFEN = data.fen;
            renderBoard();
            updateStatus('FEN position loaded', 'success');
            document.getElementById('fenInput').value = '';
            lastSuggestion = null;
        } else {
            updateStatus(data.error || 'Invalid FEN', 'error');
        }
    } catch (error) {
        updateStatus('Error loading FEN', 'error');
    }
}

// Save game
async function saveGame() {
    const format = 'pgn'; // Default format
    try {
        const response = await fetch(`${API_URL}/save`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ format })
        });
        const data = await response.json();
        
        if (data.success) {
            document.getElementById('saveData').value = data.data;
            document.getElementById('saveModal').style.display = 'flex';
        }
    } catch (error) {
        updateStatus('Error saving game', 'error');
    }
}

// Close save modal
function closeSaveModal() {
    document.getElementById('saveModal').style.display = 'none';
}

// Download save file
function downloadSave() {
    const format = document.getElementById('saveFormat').value;
    const data = document.getElementById('saveData').value;
    const filename = `chess_game_${Date.now()}.${format}`;
    
    const blob = new Blob([data], { type: 'text/plain' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
    
    closeSaveModal();
    updateStatus('Game saved successfully', 'success');
}

// Load game from file
async function loadGame(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = async (e) => {
        const content = e.target.result;
        const format = file.name.endsWith('.pgn') ? 'pgn' : 'fen';
        
        try {
            const response = await fetch(`${API_URL}/load`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content, format })
            });
            const data = await response.json();
            
            if (data.success) {
                currentFEN = data.fen;
                renderBoard();
                updateStatus('Game loaded successfully', 'success');
                lastSuggestion = null;
            } else {
                updateStatus(data.error || 'Error loading game', 'error');
            }
        } catch (error) {
            updateStatus('Error loading game', 'error');
        }
    };
    reader.readAsText(file);
    event.target.value = '';
}

// Update slider values
document.addEventListener('DOMContentLoaded', function() {
    document.getElementById('time').addEventListener('input', (e) => {
        document.getElementById('timeValue').textContent = e.target.value;
    });

    document.getElementById('threads').addEventListener('input', (e) => {
        document.getElementById('threadsValue').textContent = e.target.value;
    });

    document.getElementById('memory').addEventListener('input', (e) => {
        document.getElementById('memoryValue').textContent = e.target.value;
    });
    
    document.getElementById('volume').addEventListener('input', (e) => {
        const volume = e.target.value / 100;
        soundManager.setVolume(volume);
        document.getElementById('volumeValue').textContent = e.target.value;
        // Save volume preference
        localStorage.setItem('chessVolume', e.target.value);
    });
    
    // Add button click sounds to all buttons
    document.querySelectorAll('.button').forEach(button => {
        button.addEventListener('click', () => {
            soundManager.playSound('button');
        });
    });
    
    // Refresh active games periodically
    setInterval(() => {
        if (gameMode === 'multiplayer' && !multiplayerGame) {
            fetchActiveGames();
        }
    }, 5000);
});

// Sound control functions
function toggleSounds() {
    const enabled = document.getElementById('soundEnabled').checked;
    soundManager.enabled = enabled;
    localStorage.setItem('chessSoundsEnabled', enabled);
    
    if (enabled) {
        soundManager.playSound('button');
    }
}

function testSound() {
    soundManager.playSound('move');
    setTimeout(() => soundManager.playSound('capture'), 200);
    setTimeout(() => soundManager.playComplexSound('castle'), 400);
}

// Handle color change
function handleColorChange() {
    playerColor = document.getElementById('playerColor').value;
    renderBoard(); // Re-render board with new orientation
    updateConfig(); // Update server config
}

// Change board theme
function changeTheme() {
    const theme = document.getElementById('boardTheme').value;
    const root = document.documentElement;
    
    const themes = {
        default: {
            light: '#f0d9b5',
            dark: '#b58863',
            lightTexture: 'linear-gradient(45deg, rgba(139, 69, 19, 0.1) 25%, transparent 25%), linear-gradient(-45deg, rgba(139, 69, 19, 0.1) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, rgba(139, 69, 19, 0.1) 75%), linear-gradient(-45deg, transparent 75%, rgba(139, 69, 19, 0.1) 75%)',
            darkTexture: 'linear-gradient(45deg, rgba(101, 67, 33, 0.3) 25%, transparent 25%), linear-gradient(-45deg, rgba(101, 67, 33, 0.3) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, rgba(101, 67, 33, 0.3) 75%), linear-gradient(-45deg, transparent 75%, rgba(101, 67, 33, 0.3) 75%)',
            highlight: '#7fc470',
            suggestionFrom: '#5587d4',
            suggestionTo: '#4472c4'
        },
        classic: {
            light: '#f0d9b5',
            dark: '#b58863',
            lightTexture: 'none',
            darkTexture: 'none',
            highlight: '#7fc470',
            suggestionFrom: '#5587d4',
            suggestionTo: '#4472c4'
        },
        blue: {
            light: '#eeeee2',
            dark: '#6e8ca8',
            lightTexture: 'none',
            darkTexture: 'none',
            highlight: '#7fc470',
            suggestionFrom: '#ffeb3b',
            suggestionTo: '#ffc107'
        },
        green: {
            light: '#ffffdd',
            dark: '#86a666',
            lightTexture: 'none',
            darkTexture: 'none',
            highlight: '#ff6b6b',
            suggestionFrom: '#4ecdc4',
            suggestionTo: '#45b7aa'
        },
        purple: {
            light: '#efefef',
            dark: '#7d4a8d',
            lightTexture: 'none',
            darkTexture: 'none',
            highlight: '#ff6b6b',
            suggestionFrom: '#4ecdc4',
            suggestionTo: '#45b7aa'
        },
        contrast: {
            light: '#ffffff',
            dark: '#5a5a5a',
            lightTexture: 'none',
            darkTexture: 'none',
            highlight: '#00ff00',
            suggestionFrom: '#ff0000',
            suggestionTo: '#cc0000'
        },
        dark: {
            light: '#2e2e2e',
            dark: '#1a1a1a',
            lightTexture: 'none',
            darkTexture: 'none',
            highlight: '#4a4a4a',
            suggestionFrom: '#3a5a8a',
            suggestionTo: '#2a4a7a'
        },
        wood: {
            light: '#deb887',
            dark: '#8b4513',
            lightTexture: 'repeating-linear-gradient(0deg, rgba(139, 69, 19, 0.1), rgba(139, 69, 19, 0.1) 2px, transparent 2px, transparent 4px), repeating-linear-gradient(90deg, rgba(160, 82, 45, 0.15), rgba(160, 82, 45, 0.15) 1px, transparent 1px, transparent 3px), radial-gradient(ellipse at center, rgba(101, 67, 33, 0.1) 0%, transparent 50%)',
            darkTexture: 'repeating-linear-gradient(0deg, rgba(101, 67, 33, 0.2), rgba(101, 67, 33, 0.2) 2px, transparent 2px, transparent 4px), repeating-linear-gradient(90deg, rgba(139, 69, 19, 0.25), rgba(139, 69, 19, 0.25) 1px, transparent 1px, transparent 3px), radial-gradient(ellipse at center, rgba(83, 53, 10, 0.2) 0%, transparent 50%)',
            highlight: '#90ee90',
            suggestionFrom: '#4682b4',
            suggestionTo: '#1e90ff'
        }
    };
    
    const selectedTheme = themes[theme];
    root.style.setProperty('--light-square', selectedTheme.light);
    root.style.setProperty('--dark-square', selectedTheme.dark);
    root.style.setProperty('--light-texture', selectedTheme.lightTexture);
    root.style.setProperty('--dark-texture', selectedTheme.darkTexture);
    root.style.setProperty('--highlight-color', selectedTheme.highlight);
    root.style.setProperty('--suggestion-from', selectedTheme.suggestionFrom);
    root.style.setProperty('--suggestion-to', selectedTheme.suggestionTo);
    
    // Save theme preference
    localStorage.setItem('chessTheme', theme);
}

// Load saved theme and sound settings on startup
function loadSavedSettings() {
    // Load theme
    const savedTheme = localStorage.getItem('chessTheme');
    if (savedTheme) {
        document.getElementById('boardTheme').value = savedTheme;
        changeTheme();
    }
    
    // Load sound settings
    const savedSoundsEnabled = localStorage.getItem('chessSoundsEnabled');
    if (savedSoundsEnabled !== null) {
        const enabled = savedSoundsEnabled === 'true';
        document.getElementById('soundEnabled').checked = enabled;
        soundManager.enabled = enabled;
    }
    
    const savedVolume = localStorage.getItem('chessVolume');
    if (savedVolume) {
        document.getElementById('volume').value = savedVolume;
        document.getElementById('volumeValue').textContent = savedVolume;
        soundManager.setVolume(savedVolume / 100);
    }
}

// Initialize on load
window.addEventListener('load', () => {
    loadSavedSettings();
    init();
});
