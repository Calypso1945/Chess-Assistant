const API_URL = 'http://localhost:5000/api';
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

const pieceUnicode = {
    'K': '♔', 'Q': '♕', 'R': '♖', 'B': '♗', 'N': '♘', 'P': '♙',
    'k': '♚', 'q': '♛', 'r': '♜', 'b': '♝', 'n': '♞', 'p': '♟'
};

// Initialize the application
async function init() {
    try {
        const response = await fetch(`${API_URL}/init`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        const data = await response.json();
        
        if (data.success) {
            currentFEN = data.fen;
            renderBoard();
            updateStatus('Engine initialized successfully', 'success');
        } else {
            updateStatus('Failed to initialize engine', 'error');
        }
    } catch (error) {
        updateStatus('Error connecting to server: ' + error.message, 'error');
    }
}

// Render the chess board
function renderBoard() {
    const boardElement = document.getElementById('board');
    boardElement.innerHTML = '';
    
    const [position, turn, castling, enPassant, halfmove, fullmove] = parseFEN(currentFEN);
    const isFlipped = playerColor === 'black';
    
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
            
            if (data.computer_move) {
                setTimeout(() => {
                    currentFEN = data.fen;
                    renderBoard();
                    updateMoveHistory(data.move_history);
                }, 100);
            }
            
            if (data.game_over) {
                updateStatus(`Game Over! Result: ${data.result}`, 'success');
            } else {
                updateStatus('Move made successfully', 'success');
            }
            
            lastSuggestion = null;
        } else {
            updateStatus(data.error || 'Invalid move', 'error');
        }
    } catch (error) {
        updateStatus('Error making move: ' + error.message, 'error');
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
});

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

// Load saved theme on startup
function loadSavedTheme() {
    const savedTheme = localStorage.getItem('chessTheme');
    if (savedTheme) {
        document.getElementById('boardTheme').value = savedTheme;
        changeTheme();
    }
}

// Initialize on load
window.addEventListener('load', () => {
    loadSavedTheme();
    init();
});
