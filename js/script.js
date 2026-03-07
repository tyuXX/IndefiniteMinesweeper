const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

let grid = new InfiniteGrid();
let CELL_SIZE = 40;
let cameraX = 0;
let cameraY = 0;

// Waypoint system
let waypoints = [];
let currentWaypointIndex = -1;

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
let longPressTriggered = false;

function screenToWorld(sx, sy) {
    const cx = sx - canvas.width / 2;
    const cy = sy - canvas.height / 2;
    return {
        x: Math.floor((cx + cameraX) / CELL_SIZE),
        y: Math.floor((cy + cameraY) / CELL_SIZE)
    };
}

function isUITarget(target) {
    return target.closest('#ui-layer') || target.closest('.glass-panel') || target.closest('.modal-backdrop');
}

canvas.addEventListener('pointerdown', e => {
    isDragging = true;
    hasDragged = false;
    longPressTriggered = false; // Reset long press flag
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
                longPressTriggered = true; // Mark that long press occurred
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
    } else if (isDragging && !isUITarget(e.target)) {
        const dx = e.clientX - dragStartX;
        const dy = e.clientY - dragStartY;
        if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
            hasDragged = true;
            clearTimeout(longPressTimeout);
        }
        cameraX = camStartX - dx;
        cameraY = camStartY - dy;
        draw();
    } else if (!isUITarget(e.target)) {
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

    // Check if click originated from UI elements
    if (isUITarget(e.target)) {
        return; // Don't process game interactions for UI clicks
    }

    // Only process tap if it wasn't a long press and wasn't a drag
    if (!hasDragged && !longPressTriggered && e.button !== 2) {
        const worldPos = screenToWorld(e.clientX, e.clientY);
        const action = flagMode ? 'flag' : (e.button === 1 ? 'chord' : 'reveal');
        handleInteraction(worldPos.x, worldPos.y, action);
    } else if (hasDragged) {
        saveState();
    }
    
    // Reset long press flag
    longPressTriggered = false;
});

window.addEventListener('pointercancel', e => {
    activePointers.delete(e.pointerId);
    clearTimeout(longPressTimeout);
    isDragging = false;
    longPressTriggered = false; // Reset long press flag on cancel
});

canvas.addEventListener('contextmenu', e => {
    e.preventDefault();
    if (!hasDragged) {
        const worldPos = screenToWorld(e.clientX, e.clientY);
        handleInteraction(worldPos.x, worldPos.y, 'flag');
    }
});

// Prevent UI layer context menu from triggering canvas interactions
document.getElementById('ui-layer').addEventListener('contextmenu', (e) => {
    e.stopPropagation();
    e.preventDefault();
});

// For touch devices (long press to flag could be added, but right click works for now)
canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const zoomFactor = -e.deltaY * 0.01;
    applyZoom(zoomFactor * 5);
}, { passive: false });

function applyZoom(delta) {
    const oldCellSize = CELL_SIZE;
    CELL_SIZE = Math.max(5, CELL_SIZE + delta); // Only minimum constraint, remove maximum

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

    // Level of Detail (LoD) system
    const lodLevel = getLoDLevel(CELL_SIZE);
    
    for (let x = startX; x <= endX; x++) {
        for (let y = startY; y <= endY; y++) {
            const cell = grid.getCell(x, y);
            const px = canvas.width / 2 - cameraX + x * CELL_SIZE;
            const py = canvas.height / 2 - cameraY + y * CELL_SIZE;

            if (!cell.isRevealed) {
                // Draw hidden cell with LoD
                ctx.fillStyle = (x === hoverX && y === hoverY) ? colors.hiddenHover : colors.hidden;
                ctx.fillRect(px, py, CELL_SIZE, CELL_SIZE);
                
                // Only draw stroke at higher LoD levels
                if (lodLevel >= 2) {
                    ctx.strokeRect(px, py, CELL_SIZE, CELL_SIZE);
                }

                if (cell.isFlagged && lodLevel >= 2) {
                    ctx.fillStyle = colors.flag;
                    ctx.font = `bold ${CELL_SIZE * 0.55}px Inter, sans-serif`;
                    ctx.fillText('⚑', px + CELL_SIZE / 2, py + CELL_SIZE / 2);
                }
            } else {
                // Draw revealed cell with LoD
                if (lodLevel >= 2) {
                    ctx.strokeRect(px, py, CELL_SIZE, CELL_SIZE);
                }
                
                if (cell.isMine && lodLevel >= 3) {
                    ctx.fillStyle = colors.mine;
                    ctx.font = `bold ${CELL_SIZE * 0.55}px Inter, sans-serif`;
                    ctx.fillText('💣', px + CELL_SIZE / 2, py + CELL_SIZE / 2);
                } else if (cell.adjacentMines > 0 && lodLevel >= 4) {
                    ctx.fillStyle = numberColors[cell.adjacentMines];
                    ctx.font = `bold ${CELL_SIZE * 0.55}px Inter, sans-serif`;
                    ctx.fillText(cell.adjacentMines.toString(), px + CELL_SIZE / 2, py + CELL_SIZE / 2);
                } else if (cell.adjacentMines > 0 && lodLevel === 3) {
                    // At medium zoom, show colored dots instead of numbers
                    ctx.fillStyle = numberColors[cell.adjacentMines];
                    ctx.beginPath();
                    ctx.arc(px + CELL_SIZE / 2, py + CELL_SIZE / 2, CELL_SIZE * 0.1, 0, Math.PI * 2);
                    ctx.fill();
                }
            }
        }
    }
}

function getLoDLevel(cellSize) {
    if (cellSize < 15) return 1; // Very low detail - only basic colors
    if (cellSize < 25) return 2; // Low detail - basic colors + strokes
    if (cellSize < 40) return 3; // Medium detail - colors + strokes + simplified icons
    return 4; // Full detail - everything
}

document.getElementById('newGameBtn').addEventListener('click', (e) => {
    e.stopPropagation(); // Prevent click from reaching canvas
    grid = new InfiniteGrid();
    cameraX = 0;
    cameraY = 0;
    updateUI();
    document.getElementById('game-over').classList.add('hidden');
    saveState();
    draw();
});

document.getElementById('suicideBtn').addEventListener('click', (e) => {
    e.stopPropagation(); // Prevent click from reaching canvas
    grid.lives = 0;
    grid.gameOver = true;
    document.getElementById('game-over').classList.remove('hidden');
    updateUI();
    saveState();
    draw();
});

document.getElementById('flagBtn').addEventListener('click', (e) => {
    e.stopPropagation(); // Prevent click from reaching canvas
    flagMode = !flagMode;
    document.getElementById('flagBtn').classList.toggle('active', flagMode);
});

document.getElementById('zoomInBtn').addEventListener('click', (e) => {
    e.stopPropagation(); // Prevent click from reaching canvas
    applyZoom(10);
});

document.getElementById('zoomOutBtn').addEventListener('click', (e) => {
    e.stopPropagation(); // Prevent click from reaching canvas
    applyZoom(-10);
});

document.getElementById('recenterBtn').addEventListener('click', (e) => {
    e.stopPropagation(); // Prevent click from reaching canvas
    cameraX = 0;
    cameraY = 0;
    saveState();
    draw();
});

// Waypoint modal system
document.getElementById('waypointsBtn').addEventListener('click', (e) => {
    e.stopPropagation(); // Prevent click from reaching canvas
    openWaypointsModal();
});

document.getElementById('closeWaypointsBtn').addEventListener('click', (e) => {
    e.stopPropagation(); // Prevent click from reaching canvas
    closeWaypointsModal();
});

document.getElementById('addWaypointBtn').addEventListener('click', (e) => {
    e.stopPropagation(); // Prevent click from reaching canvas
    const name = prompt('Enter waypoint name (optional):');
    if (name !== null) {
        addWaypoint(cameraX, cameraY, name);
        saveState();
        updateWaypointsList();
    }
});

function openWaypointsModal() {
    document.getElementById('waypointsBackdrop').classList.remove('hidden');
    document.getElementById('waypointsModal').classList.remove('hidden');
    updateWaypointsList();
}

function closeWaypointsModal() {
    document.getElementById('waypointsBackdrop').classList.add('hidden');
    document.getElementById('waypointsModal').classList.add('hidden');
}

// Close modal when clicking backdrop
document.getElementById('waypointsBackdrop').addEventListener('click', () => {
    closeWaypointsModal();
});

// Close modal when clicking outside the modal content
document.getElementById('waypointsModal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) {
        closeWaypointsModal();
    }
});

// Close modal with Escape key
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        closeWaypointsModal();
    }
});

function updateWaypointsList() {
    const list = document.getElementById('waypointsList');
    
    if (waypoints.length === 0) {
        list.innerHTML = '<div class="empty-waypoints">No waypoints yet. Add your current position to get started!</div>';
        return;
    }
    
    list.innerHTML = waypoints.map((waypoint, index) => `
        <div class="waypoint-item ${index === currentWaypointIndex ? 'current' : ''}">
            <div class="waypoint-info">
                <div class="waypoint-name">${waypoint.name}</div>
                <div class="waypoint-coords">X: ${Math.round(waypoint.x)}, Y: ${Math.round(waypoint.y)}</div>
            </div>
            <div class="waypoint-actions">
                <button onclick="event.stopPropagation(); goToWaypoint(${index})">Go To</button>
                <button class="delete" onclick="event.stopPropagation(); removeWaypoint(${index}); updateWaypointsList();">Delete</button>
            </div>
        </div>
    `).join('');
}

function saveState() {
    const state = {
        grid: grid.serialize(),
        camera: { x: cameraX, y: cameraY },
        waypoints: waypoints,
        currentWaypointIndex: currentWaypointIndex
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
            waypoints = state.waypoints || [];
            currentWaypointIndex = state.currentWaypointIndex || -1;
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

// Waypoint management functions
function addWaypoint(x, y, name) {
    const waypoint = {
        x: x,
        y: y,
        name: name || `Waypoint ${waypoints.length + 1}`,
        timestamp: Date.now()
    };
    waypoints.push(waypoint);
    return waypoint;
}

function removeWaypoint(index) {
    if (index >= 0 && index < waypoints.length) {
        waypoints.splice(index, 1);
        if (currentWaypointIndex >= index) {
            currentWaypointIndex--;
        }
    }
}

function goToWaypoint(index) {
    if (index >= 0 && index < waypoints.length) {
        const waypoint = waypoints[index];
        cameraX = waypoint.x;
        cameraY = waypoint.y;
        currentWaypointIndex = index;
        saveState();
        draw();
        return true;
    }
    return false;
}

function navigateWaypoints(direction) {
    if (waypoints.length === 0) return false;
    
    if (direction === 'next') {
        currentWaypointIndex = (currentWaypointIndex + 1) % waypoints.length;
    } else if (direction === 'prev') {
        currentWaypointIndex = currentWaypointIndex <= 0 ? waypoints.length - 1 : currentWaypointIndex - 1;
    }
    
    return goToWaypoint(currentWaypointIndex);
}

// Prevent UI layer clicks from reaching canvas
document.getElementById('ui-layer').addEventListener('click', (e) => {
    e.stopPropagation();
});

// Initialization
loadState();
resizeCanvas(); // Calls draw()
