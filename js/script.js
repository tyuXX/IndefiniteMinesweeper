const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

const CONFIG = {
    CELL_SIZE: 40,
    MIN_CELL_SIZE: 5,
    LONG_PRESS_DURATION: 500,
    DRAG_THRESHOLD: 5,
    PINCH_ZOOM_SENSITIVITY: 0.5,
    WHEEL_ZOOM_SENSITIVITY: 0.01,
    WHEEL_ZOOM_MULTIPLIER: 5,
    ZOOM_BUTTON_DELTA: 10,
    SAVE_DEBOUNCE_TIME: 1000,
    LOD_LEVEL_0_THRESHOLD: 8,
    LOD_LEVEL_1_THRESHOLD: 15,
    LOD_LEVEL_2_THRESHOLD: 25,
    LOD_LEVEL_3_THRESHOLD: 40
};

let grid = new InfiniteGrid();
let CELL_SIZE = CONFIG.CELL_SIZE;
let cameraX = 0;
let cameraY = 0;

// Rendering optimization
let animationFrameId = null;
let needsRedraw = false;

// Debounced save state
let saveTimeout = null;
let savePending = false;

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
    requestDraw();
}
window.addEventListener('resize', resizeCanvas);

function requestDraw() {
    if (!needsRedraw) {
        needsRedraw = true;
        if (!animationFrameId) {
            animationFrameId = requestAnimationFrame(renderLoop);
        }
    }
}

function renderLoop() {
    if (needsRedraw) {
        draw();
        needsRedraw = false;
    }
    animationFrameId = null;
}

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
let longPressX = null;
let longPressY = null;
let lastPointerType = 'mouse';

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
    lastPointerType = e.pointerType;
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
                longPressX = worldPos.x;
                longPressY = worldPos.y;
                handleInteraction(worldPos.x, worldPos.y, 'flag');
                navigator.vibrate?.(50); // Haptic feedback
                isDragging = false; // Prevent drag after long press
                longPressTriggered = true; // Mark that long press occurred
            }
        }, CONFIG.LONG_PRESS_DURATION);
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
            const zoomDelta = (dist - lastPinchDist) * CONFIG.PINCH_ZOOM_SENSITIVITY;
            applyZoom(zoomDelta);
        }
        lastPinchDist = dist;
        hasDragged = true;
        clearTimeout(longPressTimeout);
    } else if (isDragging && !isUITarget(e.target)) {
        const dx = e.clientX - dragStartX;
        const dy = e.clientY - dragStartY;
        if (Math.abs(dx) > CONFIG.DRAG_THRESHOLD || Math.abs(dy) > CONFIG.DRAG_THRESHOLD) {
            hasDragged = true;
            clearTimeout(longPressTimeout);
        }
        cameraX = camStartX - dx;
        cameraY = camStartY - dy;
        requestDraw();
    } else if (!isUITarget(e.target)) {
        const worldPos = screenToWorld(e.clientX, e.clientY);
        if (hoverX !== worldPos.x || hoverY !== worldPos.y) {
            hoverX = worldPos.x;
            hoverY = worldPos.y;
            requestDraw();
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
        longPressTriggered = false;
        longPressX = null;
        longPressY = null;
        return; // Don't process game interactions for UI clicks
    }

    // Only process tap if it wasn't a long press and wasn't a drag
    if (!hasDragged && !longPressTriggered && e.button !== 2) {
        const worldPos = screenToWorld(e.clientX, e.clientY);
        // Prevent double-toggling if this is the same cell as long press
        if (longPressX !== null && longPressY !== null && worldPos.x === longPressX && worldPos.y === longPressY) {
            longPressTriggered = false;
            longPressX = null;
            longPressY = null;
            return;
        }
        const action = flagMode ? 'flag' : (e.button === 1 ? 'chord' : 'reveal');
        handleInteraction(worldPos.x, worldPos.y, action);
    } else if (hasDragged) {
        saveState();
    }

    // Reset long press flag after processing
    longPressTriggered = false;
    longPressX = null;
    longPressY = null;
});

window.addEventListener('pointercancel', e => {
    activePointers.delete(e.pointerId);
    clearTimeout(longPressTimeout);
    isDragging = false;
    longPressTriggered = false; // Reset long press flag on cancel
});

canvas.addEventListener('contextmenu', e => {
    e.preventDefault();
    // Touch long press is handled by the long press timer; the browser also
    // fires contextmenu for it, which would toggle the flag right back off.
    if (lastPointerType === 'touch') return;
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
    const zoomFactor = -e.deltaY * CONFIG.WHEEL_ZOOM_SENSITIVITY;
    applyZoom(zoomFactor * CONFIG.WHEEL_ZOOM_MULTIPLIER);
}, { passive: false });

function applyZoom(delta) {
    const oldCellSize = CELL_SIZE;
    CELL_SIZE = Math.max(CONFIG.MIN_CELL_SIZE, CELL_SIZE + delta);

    const scale = CELL_SIZE / oldCellSize;
    cameraX *= scale;
    cameraY *= scale;

    requestDraw();
    saveState();
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
    requestDraw();

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

    // Skip rendering entirely at extreme zoom levels
    if (lodLevel === 0) {
        // Draw simplified blocks
        for (let x = startX; x <= endX; x++) {
            for (let y = startY; y <= endY; y++) {
                const cell = grid.getCell(x, y);
                const px = canvas.width / 2 - cameraX + x * CELL_SIZE;
                const py = canvas.height / 2 - cameraY + y * CELL_SIZE;

                ctx.fillStyle = cell.isRevealed ? colors.revealed : colors.hidden;
                ctx.fillRect(px, py, CELL_SIZE, CELL_SIZE);
            }
        }
        return;
    }

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
    if (cellSize < CONFIG.LOD_LEVEL_0_THRESHOLD) return 0; // Aggressive culling - solid blocks only
    if (cellSize < CONFIG.LOD_LEVEL_1_THRESHOLD) return 1; // Very low detail - only basic colors
    if (cellSize < CONFIG.LOD_LEVEL_2_THRESHOLD) return 2; // Low detail - basic colors + strokes
    if (cellSize < CONFIG.LOD_LEVEL_3_THRESHOLD) return 3; // Medium detail - colors + strokes + simplified icons
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
    requestDraw();
});

document.getElementById('suicideBtn').addEventListener('click', (e) => {
    e.stopPropagation(); // Prevent click from reaching canvas
    grid.lives = 0;
    grid.gameOver = true;
    document.getElementById('game-over').classList.remove('hidden');
    updateUI();
    saveState();
    requestDraw();
});

document.getElementById('flagBtn').addEventListener('click', (e) => {
    e.stopPropagation(); // Prevent click from reaching canvas
    flagMode = !flagMode;
    document.getElementById('flagBtn').classList.toggle('active', flagMode);
});

document.getElementById('zoomInBtn').addEventListener('click', (e) => {
    e.stopPropagation(); // Prevent click from reaching canvas
    applyZoom(CONFIG.ZOOM_BUTTON_DELTA);
});

document.getElementById('zoomOutBtn').addEventListener('click', (e) => {
    e.stopPropagation(); // Prevent click from reaching canvas
    applyZoom(-CONFIG.ZOOM_BUTTON_DELTA);
});

document.getElementById('recenterBtn').addEventListener('click', (e) => {
    e.stopPropagation(); // Prevent click from reaching canvas
    cameraX = 0;
    cameraY = 0;
    saveState();
    requestDraw();
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
    if (saveTimeout) {
        savePending = true;
        return;
    }

    const state = {
        grid: grid.serialize(),
        camera: { x: cameraX, y: cameraY },
        waypoints: waypoints,
        currentWaypointIndex: currentWaypointIndex
    };
    try {
        localStorage.setItem('minesweeper_save', JSON.stringify(state));
    } catch (e) {
        if (e.name === 'QuotaExceededError') {
            console.warn("LocalStorage quota exceeded, clearing old saves");
            try {
                localStorage.removeItem('minesweeper_save');
                localStorage.setItem('minesweeper_save', JSON.stringify(state));
            } catch (retryError) {
                console.error("Failed to save game state even after cleanup:", retryError);
            }
        } else {
            console.error("Failed to save game state:", e);
        }
    }

    saveTimeout = setTimeout(() => {
        saveTimeout = null;
        if (savePending) {
            savePending = false;
            saveState();
        }
    }, CONFIG.SAVE_DEBOUNCE_TIME);
}

function loadState() {
    try {
        const saved = localStorage.getItem('minesweeper_save');
        if (saved) {
            const state = JSON.parse(saved);
            if (!state || !state.grid || !state.camera) {
                console.warn("Invalid save state format");
                return false;
            }
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
        if (e instanceof SyntaxError) {
            console.error("Failed to parse save state (corrupted data):", e);
        } else {
            console.error("Failed to load game state:", e);
        }
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
        requestDraw();
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
resizeCanvas(); // Calls requestDraw()
