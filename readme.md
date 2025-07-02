# Chess Assistant

A modern web-based chess interface with computer analysis powered by Stockfish.

## Features

- Interactive chess board with drag & drop
- Multiple board themes
- Computer move suggestions
- Game analysis
- Save/Load games (PGN/FEN)
- Adjustable engine settings
- Move history tracking

## Quick Setup

### 1. Install Python Dependencies
```bash
pip install -r requirements.txt
```

### 2. Get Stockfish Engine
1. Download Stockfish from: https://stockfishchess.org/download/
2. Extract the downloaded file
3. Place the Stockfish executable in the `stockfish` folder:

**Folder Structure:**
```
chess-assistant/
├── app.py
├── index.html
├── styles.css
├── script.js
├── requirements.txt
├── README.md
└── stockfish/
    └── stockfish.exe (Windows) or stockfish (Linux/Mac)
```

### 3. Run the Application
```bash
python app.py
```

### 4. Open Your Browser
Go to: http://localhost:5000

## Stockfish Setup Details

The app will automatically look for Stockfish in these locations (in order):
1. Same directory as `app.py`
2. `stockfish/` subdirectory (recommended)
3. `engines/` subdirectory
4. `bin/` subdirectory

**Platform-specific filenames:**
- **Windows**: `stockfish.exe`
- **Linux/Mac**: `stockfish` (make sure it's executable: `chmod +x stockfish`)

## Troubleshooting

### "Stockfish engine not found" Error
1. Make sure you downloaded Stockfish from the official website
2. Check that the executable is in the `stockfish/` folder
3. On Linux/Mac, make sure the file is executable:
   ```bash
   chmod +x stockfish/stockfish
   ```

### Port 5000 Already in Use
Change the port in `app.py`:
```python
app.run(debug=True, port=5001)  # Change to any available port
```

### Browser Issues
- Use a modern browser (Chrome, Firefox, Safari, Edge)
- Make sure JavaScript is enabled

## Configuration

Adjust engine settings through the web interface:
- **Thinking Time**: 0.1-10 seconds
- **CPU Threads**: Number of CPU cores to use
- **Memory**: Hash table size for the engine

## License

This project is open source. Stockfish is licensed under GPL v3.