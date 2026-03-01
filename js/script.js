const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

let grid = new InfiniteGrid();
let CELL_SIZE = 40;
let cameraX = 0;
let cameraY = 0;

// Colors matching CSS var naming roughly
const colors = {
    hidden: '#21262d',
    hiddenHover: '#30363d',
    revealed: '#0d1117',
    stroke: '#30363d',
    text: '#c9d1d9',
    mine: '#f85149',
    flag: '#58a6ff'
};

const numberColors = [
    '', // 0
    '#58a6ff', // 1 
    '#3fb950', // 2
    '#f85149', // 3
    '#bc8cff', // 4
    '#e3b341', // 5
    '#56d364', // 6
    '#f78166', // 7
    '#8b949e'  // 8
];

function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    draw();
}
window.addEventListener('resize', resizeCanvas);

// Input handling
let isDragging = false;
let dragStartX = 0;
let dragStartY = 0;
let camStartX = 0;
let camStartY = 0;
let hasDragged = false;
let hoverX = null;
let hoverY = null;
let flagMode = false;
let longPressTimeout = null;
let lastPinchDist = null;

function screenToWorld(sx, sy) {
    const cx = sx - canvas.width / 2;
    const cy = sy - canvas.height / 2;
    return {
        x: Math.floor((cx + cameraX) / CELL_SIZE),
        y: Math.floor((cy + cameraY) / CELL_SIZE)
    };
}

canvas.addEventListener('pointerdown', e => {
    isDragging = true;
    hasDragged = false;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    camStartX = cameraX;
    camStartY = cameraY;

    // Long press to flag
    if (e.pointerType === 'touch') {
        clearTimeout(longPressTimeout);
        longPressTimeout = setTimeout(() => {
            if (!hasDragged) {
                const worldPos = screenToWorld(e.clientX, e.clientY);
                handleInteraction(worldPos.x, worldPos.y, 'flag');
                navigator.vibrate?.(50); // Haptic feedback
                isDragging = false; // Prevent drag after long press
            }
        }, 500);
    }

    if (e.button === 1) e.preventDefault(); // middle click panning
});

const activePointers = new Map();

window.addEventListener('pointermove', e => {
    activePointers.set(e.pointerId, e);

    if (activePointers.size === 2) {
        // Pinch to zoom
        const [p1, p2] = Array.from(activePointers.values());
        const dist = Math.hypot(p1.clientX - p2.clientX, p1.clientY - p2.clientY);

        if (lastPinchDist) {
            const zoomDelta = (dist - lastPinchDist) * 0.5;
            applyZoom(zoomDelta);
        }
        lastPinchDist = dist;
        hasDragged = true;
        clearTimeout(longPressTimeout);
    } else if (isDragging) {
        const dx = e.clientX - dragStartX;
        const dy = e.clientY - dragStartY;
        if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
            hasDragged = true;
            clearTimeout(longPressTimeout);
        }
        cameraX = camStartX - dx;
        cameraY = camStartY - dy;
        draw();
    } else {
        const worldPos = screenToWorld(e.clientX, e.clientY);
        if (hoverX !== worldPos.x || hoverY !== worldPos.y) {
            hoverX = worldPos.x;
            hoverY = worldPos.y;
            draw();
        }
    }
});

window.addEventListener('pointerup', e => {
    activePointers.delete(e.pointerId);
    if (activePointers.size < 2) lastPinchDist = null;

    isDragging = false;
    clearTimeout(longPressTimeout);

    if (!hasDragged && e.button !== 2) {
        const worldPos = screenToWorld(e.clientX, e.clientY);
        const action = flagMode ? 'flag' : (e.button === 1 ? 'chord' : 'reveal');
        handleInteraction(worldPos.x, worldPos.y, action);
    } else if (hasDragged) {
        saveState();
    }
});

window.addEventListener('pointercancel', e => {
    activePointers.delete(e.pointerId);
    clearTimeout(longPressTimeout);
    isDragging = false;
});

canvas.addEventListener('contextmenu', e => {
    e.preventDefault();
    if (!hasDragged) {
        const worldPos = screenToWorld(e.clientX, e.clientY);
        handleInteraction(worldPos.x, worldPos.y, 'flag');
    }
});

// For touch devices (long press to flag could be added, but right click works for now)
canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const zoomFactor = -e.deltaY * 0.01;
    applyZoom(zoomFactor * 5);
}, { passive: false });

function applyZoom(delta) {
    const oldCellSize = CELL_SIZE;
    CELL_SIZE = Math.min(Math.max(20, CELL_SIZE + delta), 100);

    // Zoom toward center
    const scale = CELL_SIZE / oldCellSize;
    cameraX *= scale;
    cameraY *= scale;

    draw();
    clearTimeout(window.zoomSaveTimeout);
    window.zoomSaveTimeout = setTimeout(saveState, 500);
}

function handleInteraction(x, y, action) {
    if (grid.gameOver) return;

    if (action === 'reveal') {
        grid.reveal(x, y);
    } else if (action === 'flag') {
        grid.toggleFlag(x, y);
    } else if (action === 'chord') {
        grid.chord(x, y);
    }

    updateUI();
    draw();

    if (grid.gameOver) {
        document.getElementById('game-over').classList.remove('hidden');
    }
    saveState();
}

function updateUI() {
    document.getElementById('mines').innerText = grid.flaggedCount;
    document.getElementById('explored').innerText = grid.exploredCount;
    document.getElementById('lives').innerText = grid.lives;
}

function draw() {
    ctx.fillStyle = colors.revealed;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const startX = Math.floor((cameraX - canvas.width / 2) / CELL_SIZE) - 1;
    const endX = Math.floor((cameraX + canvas.width / 2) / CELL_SIZE) + 1;
    const startY = Math.floor((cameraY - canvas.height / 2) / CELL_SIZE) - 1;
    const endY = Math.floor((cameraY + canvas.height / 2) / CELL_SIZE) + 1;

    ctx.lineWidth = 1;
    ctx.strokeStyle = colors.stroke;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `bold ${CELL_SIZE * 0.55}px Inter, sans-serif`;

    for (let x = startX; x <= endX; x++) {
        for (let y = startY; y <= endY; y++) {
            const cell = grid.getCell(x, y);
            const px = canvas.width / 2 - cameraX + x * CELL_SIZE;
            const py = canvas.height / 2 - cameraY + y * CELL_SIZE;

            if (!cell.isRevealed) {
                // Draw hidden cell
                ctx.fillStyle = (x === hoverX && y === hoverY) ? colors.hiddenHover : colors.hidden;
                ctx.fillRect(px, py, CELL_SIZE, CELL_SIZE);
                ctx.strokeRect(px, py, CELL_SIZE, CELL_SIZE);

                if (cell.isFlagged) {
                    ctx.fillStyle = colors.flag;
                    ctx.fillText('⚑', px + CELL_SIZE / 2, py + CELL_SIZE / 2);
                }
            } else {
                // Draw revealed cell
                ctx.strokeRect(px, py, CELL_SIZE, CELL_SIZE);
                if (cell.isMine) {
                    ctx.fillStyle = colors.mine;
                    ctx.fillText('💣', px + CELL_SIZE / 2, py + CELL_SIZE / 2);
                } else if (cell.adjacentMines > 0) {
                    ctx.fillStyle = numberColors[cell.adjacentMines];
                    ctx.fillText(cell.adjacentMines.toString(), px + CELL_SIZE / 2, py + CELL_SIZE / 2);
                }
            }
        }
    }
}

document.getElementById('newGameBtn').addEventListener('click', () => {
    grid = new InfiniteGrid();
    cameraX = 0;
    cameraY = 0;
    updateUI();
    document.getElementById('game-over').classList.add('hidden');
    saveState();
    draw();
});

document.getElementById('suicideBtn').addEventListener('click', () => {
    grid.lives = 0;
    grid.gameOver = true;
    document.getElementById('game-over').classList.remove('hidden');
    updateUI();
    saveState();
    draw();
});

document.getElementById('flagBtn').addEventListener('click', () => {
    flagMode = !flagMode;
    document.getElementById('flagBtn').classList.toggle('active', flagMode);
});

document.getElementById('zoomInBtn').addEventListener('click', () => {
    applyZoom(10);
});

document.getElementById('zoomOutBtn').addEventListener('click', () => {
    applyZoom(-10);
});

document.getElementById('recenterBtn').addEventListener('click', () => {
    cameraX = 0;
    cameraY = 0;
    saveState();
    draw();
});

function saveState() {
    const state = {
        grid: grid.serialize(),
        camera: { x: cameraX, y: cameraY }
    };
    try {
        localStorage.setItem('minesweeper_save', JSON.stringify(state));
    } catch (e) {
        console.error("Failed to save game state", e);
    }
}

function loadState() {
    try {
        const saved = localStorage.getItem('minesweeper_save');
        if (saved) {
            const state = JSON.parse(saved);
            grid = new InfiniteGrid();
            grid.deserialize(state.grid);
            cameraX = state.camera.x;
            cameraY = state.camera.y;
            updateUI();
            if (grid.gameOver) {
                document.getElementById('game-over').classList.remove('hidden');
            }
            return true;
        }
    } catch (e) {
        console.error("Failed to load game state", e);
    }
    return false;
}

// Initialization
loadState();
resizeCanvas(); // Calls draw()
