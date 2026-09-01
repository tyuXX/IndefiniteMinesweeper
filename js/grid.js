// Grid configuration constants
const GRID_CONFIG = {
    CLEANUP_THRESHOLD: 5000,
    CLEANUP_INTERVAL: 2000,
    VIEWPORT_BUFFER: 50,
    LIVES_BASE_MULTIPLIER: 100,
    CHUNK_SIZE: 10
};

// A linear congruential generator for deterministic pseudo-random numbers
class PRNG {
    constructor(seed) {
        this.seed = seed % 2147483647;
        if (this.seed <= 0) this.seed += 2147483646;
    }
    next() {
        return this.seed = this.seed * 16807 % 2147483647;
    }
    nextFloat() {
        return (this.next() - 1) / 2147483646;
    }
}

class InfiniteGrid {
    constructor(seed = Math.random() * 1000000 | 0, difficulty = 0.15) {
        this.seed = seed;
        this.difficulty = difficulty; // probability of a mine

        // key is "x,y", value is state object { isMine, isRevealed, isFlagged, adjacentMines }
        this.cells = new Map();

        // key is "chunkX,chunkY", value is completion data
        this.completedChunks = new Set();

        this.exploredCount = 0;
        this.flaggedCount = 0;
        this.lives = 3;
        this.level = 1;
        this.gameOver = false;

        // Ensure the first click and its neighbors are safe
        this.safeZoneMinX = 0;
        this.safeZoneMaxX = 0;
        this.safeZoneMinY = 0;
        this.safeZoneMaxY = 0;
        this.hasFirstClick = false;

        // Memory management
        this.lastCleanup = 0;
    }

    getKey(x, y) {
        return `${x},${y}`;
    }

    getChunkKey(x, y) {
        const chunkX = Math.floor(x / GRID_CONFIG.CHUNK_SIZE);
        const chunkY = Math.floor(y / GRID_CONFIG.CHUNK_SIZE);
        return `${chunkX},${chunkY}`;
    }

    getChunkFromCell(x, y) {
        return {
            x: Math.floor(x / InfiniteGrid.CHUNK_SIZE),
            y: Math.floor(y / InfiniteGrid.CHUNK_SIZE)
        };
    }

    getChunkBounds(chunkX, chunkY) {
        return {
            minX: chunkX * InfiniteGrid.CHUNK_SIZE,
            maxX: (chunkX + 1) * InfiniteGrid.CHUNK_SIZE - 1,
            minY: chunkY * InfiniteGrid.CHUNK_SIZE,
            maxY: (chunkY + 1) * InfiniteGrid.CHUNK_SIZE - 1
        };
    }
    
    static getChunkSize() {
        return InfiniteGrid.CHUNK_SIZE;
    }

    isChunkCompleted(chunkX, chunkY) {
        const chunkKey = `${chunkX},${chunkY}`;
        if (this.completedChunks.has(chunkKey)) {
            return true;
        }

        const bounds = this.getChunkBounds(chunkX, chunkY);
        
        for (let x = bounds.minX; x <= bounds.maxX; x++) {
            for (let y = bounds.minY; y <= bounds.maxY; y++) {
                const cell = this.getCell(x, y);
                // Chunk is completed when all non-mine cells are revealed
                if (!cell.isMine && !cell.isRevealed) {
                    return false;
                }
            }
        }
        
        return true;
    }

    completeChunk(chunkX, chunkY) {
        const chunkKey = `${chunkX},${chunkY}`;
        if (this.completedChunks.has(chunkKey)) {
            return; // Already completed
        }

        const bounds = this.getChunkBounds(chunkX, chunkY);
        const chunkSize = InfiniteGrid.CHUNK_SIZE;
        
        // Remove all individual cells from storage for this chunk
        for (let x = bounds.minX; x <= bounds.maxX; x++) {
            for (let y = bounds.minY; y <= bounds.maxY; y++) {
                const key = this.getKey(x, y);
                this.cells.delete(key);
            }
        }

        // Mark chunk as completed
        this.completedChunks.add(chunkKey);
    }

    isCellInCompletedChunk(x, y) {
        const chunk = this.getChunkFromCell(x, y);
        return this.completedChunks.has(`${chunk.x},${chunk.y}`);
    }

    getAdjacentMineCount(x, y) {
        let count = 0;
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                if (dx === 0 && dy === 0) continue;
                const adjX = x + dx;
                const adjY = y + dy;
                
                // Check if adjacent cell is in a completed chunk
                if (this.isCellInCompletedChunk(adjX, adjY)) {
                    // For completed chunks, we need to recalculate the mine status
                    const isMine = this._determineIsMine(adjX, adjY);
                    if (isMine) count++;
                } else {
                    // For non-completed chunks, use the cell data
                    const cell = this.getCell(adjX, adjY);
                    if (cell.isMine) count++;
                }
            }
        }
        return count;
    }

    isAdjacentToNonCompletedChunk(x, y) {
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                if (dx === 0 && dy === 0) continue;
                const adjX = x + dx;
                const adjY = y + dy;
                if (!this.isCellInCompletedChunk(adjX, adjY)) {
                    return true;
                }
            }
        }
        return false;
    }

    // Generates or retrieves a cell
    getCell(x, y) {
        const key = this.getKey(x, y);
        if (this.cells.has(key)) {
            return this.cells.get(key);
        }

        // Check if this cell is in a completed chunk
        if (this.isCellInCompletedChunk(x, y)) {
            // Return a dummy revealed cell for completed chunks
            return {
                isMine: false,
                isRevealed: true,
                isFlagged: false,
                adjacentMines: 0
            };
        }

        // Determine if it's a mine using coordinates and seed
        let isMine = false;
        if (this.hasFirstClick) {
            isMine = this._determineIsMine(x, y);
        }

        const cell = {
            isMine: isMine,
            isRevealed: false,
            isFlagged: false,
            adjacentMines: -1 // -1 means uncalculated
        };
        this.cells.set(key, cell);
        return cell;
    }

    _determineIsMine(x, y) {
        // Check if in safe zone
        if (x >= this.safeZoneMinX && x <= this.safeZoneMaxX && y >= this.safeZoneMinY && y <= this.safeZoneMaxY) {
            return false;
        }

        // Procedural generation: hash the coordinates + seed
        // Create a deterministic hash for this coordinate
        let hash = (x * 73856093 ^ y * 19349663 ^ this.seed);
        hash = (hash ^ (hash >>> 16)) * 0x85ebca6b;
        hash = (hash ^ (hash >>> 13)) * 0xc2b2ae35;
        hash = hash ^ (hash >>> 16);

        // Convert to float 0-1
        const rand = (hash >>> 0) / 4294967296;
        return rand < this.difficulty;
    }

    calculateAdjacent(cx, cy) {
        let count = 0;
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                if (dx === 0 && dy === 0) continue;
                if (this.getCell(cx + dx, cy + dy).isMine) {
                    count++;
                }
            }
        }
        return count;
    }

    reveal(x, y) {
        if (this.gameOver) return false;

        if (!this.hasFirstClick) {
            this.safeZoneMinX = x - 2;
            this.safeZoneMaxX = x + 2;
            this.safeZoneMinY = y - 2;
            this.safeZoneMaxY = y + 2;
            this.hasFirstClick = true;

            // Re-evaluate all previously generated cells now that safe zone is known
            for (const [key, cell] of this.cells) {
                const [cx, cy] = key.split(',').map(Number);
                cell.isMine = this._determineIsMine(cx, cy);
            }
        }

        const cell = this.getCell(x, y);
        if (cell.isRevealed || cell.isFlagged) return true;

        if (cell.isMine) {
            cell.isRevealed = true;
            this.lives--;
            if (this.lives <= 0) {
                this.gameOver = true;
            }
            return false; // Hit a mine
        }

        // Iterative flood fill to prevent stack overflow
        const stack = [[x, y]];
        const affectedChunks = new Set();

        while (stack.length > 0) {
            const [cx, cy] = stack.pop();
            const currCell = this.getCell(cx, cy);

            if (currCell.isRevealed || currCell.isFlagged || currCell.isMine) continue;

            currCell.isRevealed = true;
            this.exploredCount++;
            const requiredForNextLevel = Math.floor(GRID_CONFIG.LIVES_BASE_MULTIPLIER * this.level * (Math.log10(this.level) + 1));
            if (this.exploredCount > requiredForNextLevel) {
                this.level++;
                this.lives++;
            }

            // Track chunks that might be completed
            const chunk = this.getChunkFromCell(cx, cy);
            affectedChunks.add(`${chunk.x},${chunk.y}`);

            if (currCell.adjacentMines === -1) {
                currCell.adjacentMines = this.calculateAdjacent(cx, cy);
            }

            if (currCell.adjacentMines === 0) {
                for (let dx = -1; dx <= 1; dx++) {
                    for (let dy = -1; dy <= 1; dy++) {
                        if (dx !== 0 || dy !== 0) {
                            stack.push([cx + dx, cy + dy]);
                        }
                    }
                }
            }
        }

        // Check and complete any chunks that are now finished
        for (const chunkKey of affectedChunks) {
            const [cx, cy] = chunkKey.split(',').map(Number);
            if (this.isChunkCompleted(cx, cy)) {
                this.completeChunk(cx, cy);
            }
        }

        // Periodic cleanup to prevent memory issues
        if (this.cells.size > GRID_CONFIG.CLEANUP_THRESHOLD && this.exploredCount - this.lastCleanup > GRID_CONFIG.CLEANUP_INTERVAL) {
            this.cleanupCells(x, y);
            this.lastCleanup = this.exploredCount;
        }

        return true;
    }

    toggleFlag(x, y) {
        if (this.gameOver) return;
        const cell = this.getCell(x, y);
        if (cell.isRevealed) return;

        cell.isFlagged = !cell.isFlagged;
        if (cell.isFlagged) {
            this.flaggedCount++;
        } else {
            this.flaggedCount--;
        }
    }

    // Helper to reveal neighbors if chords are met (chord feature)
    chord(x, y) {
        if (this.gameOver) return false;
        const cell = this.getCell(x, y);
        if (!cell.isRevealed || cell.adjacentMines <= 0) return true;

        let flagCount = 0;
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                if (dx === 0 && dy === 0) continue;
                if (this.getCell(x + dx, y + dy).isFlagged) flagCount++;
            }
        }

        let survived = true;
        if (flagCount === cell.adjacentMines) {
            for (let dx = -1; dx <= 1; dx++) {
                for (let dy = -1; dy <= 1; dy++) {
                    if (dx === 0 && dy === 0) continue;
                    let nx = x + dx;
                    let ny = y + dy;
                    let nCell = this.getCell(nx, ny);
                    if (!nCell.isRevealed && !nCell.isFlagged) {
                        if (!this.reveal(nx, ny)) {
                            survived = false;
                        }
                    }
                }
            }
        }
        return survived;
    }

    serialize() {
        const revealed = [];
        const flagged = [];

        for (const [key, cell] of this.cells.entries()) {
            if (cell.isRevealed) {
                revealed.push(key);
            } else if (cell.isFlagged) {
                flagged.push(key);
            }
        }

        const completedChunks = Array.from(this.completedChunks);

        return {
            seed: this.seed,
            difficulty: this.difficulty,
            exploredCount: this.exploredCount,
            flaggedCount: this.flaggedCount,
            lives: this.lives,
            level: this.level,
            gameOver: this.gameOver,
            safeZoneMinX: this.safeZoneMinX,
            safeZoneMaxX: this.safeZoneMaxX,
            safeZoneMinY: this.safeZoneMinY,
            safeZoneMaxY: this.safeZoneMaxY,
            hasFirstClick: this.hasFirstClick,
            revealed: revealed,
            flagged: flagged,
            completedChunks: completedChunks
        };
    }

    deserialize(data) {
        this.seed = data.seed;
        this.difficulty = data.difficulty;
        this.exploredCount = data.exploredCount;
        this.flaggedCount = data.flaggedCount;
        this.lives = data.lives;
        this.level = data.level || 1; // Default to level 1 for old saves
        this.gameOver = data.gameOver;
        this.safeZoneMinX = data.safeZoneMinX;
        this.safeZoneMaxX = data.safeZoneMaxX;
        this.safeZoneMinY = data.safeZoneMinY;
        this.safeZoneMaxY = data.safeZoneMaxY;
        this.hasFirstClick = data.hasFirstClick;

        this.cells.clear();
        this.completedChunks.clear();

        // Load completed chunks if available
        if (data.completedChunks && Array.isArray(data.completedChunks)) {
            for (const chunkKey of data.completedChunks) {
                this.completedChunks.add(chunkKey);
            }
        }

        for (const key of data.revealed) {
            const [x, y] = key.split(',').map(Number);
            const cell = this.getCell(x, y);
            cell.isRevealed = true;
            if (cell.adjacentMines === -1) {
                cell.adjacentMines = this.calculateAdjacent(x, y);
            }
        }

        for (const key of data.flagged) {
            const [x, y] = key.split(',').map(Number);
            const cell = this.getCell(x, y);
            cell.isFlagged = true;
        }
    }

    getLevelProgress() {
        const prevLevel = Math.max(1, this.level - 1);
        const currentLevelRequired = this.level === 1 ? 0 : Math.floor(GRID_CONFIG.LIVES_BASE_MULTIPLIER * prevLevel * (Math.log10(prevLevel) + 1));
        const nextLevelRequired = Math.floor(GRID_CONFIG.LIVES_BASE_MULTIPLIER * this.level * (Math.log10(this.level) + 1));
        const progressInRange = nextLevelRequired - currentLevelRequired;
        const currentProgress = this.exploredCount - currentLevelRequired;
        const percentage = Math.min(100, Math.max(0, (currentProgress / progressInRange) * 100));
        
        return {
            percentage: percentage,
            currentExplored: this.exploredCount,
            requiredForNextLevel: nextLevelRequired,
            requiredForCurrentLevel: currentLevelRequired
        };
    }

    cleanupCells(centerX, centerY) {
        // If no center provided, calculate from revealed cells
        if (centerX === undefined || centerY === undefined) {
            let sumX = 0, sumY = 0, count = 0;
            for (const [key, cell] of this.cells) {
                if (cell.isRevealed) {
                    const [x, y] = key.split(',').map(Number);
                    sumX += x;
                    sumY += y;
                    count++;
                }
            }

            if (count === 0) return;

            centerX = Math.floor(sumX / count);
            centerY = Math.floor(sumY / count);
        }

        const keysToDelete = [];
        const deleteRadius = GRID_CONFIG.VIEWPORT_BUFFER * 3;

        for (const [key, cell] of this.cells) {
            // Keep important cells
            if (cell.isRevealed || cell.isFlagged) continue;

            const [x, y] = key.split(',').map(Number);
            const distance = Math.max(Math.abs(x - centerX), Math.abs(y - centerY));

            if (distance > deleteRadius) {
                keysToDelete.push(key);
            }
        }

        for (const key of keysToDelete) {
            this.cells.delete(key);
        }
    }
}

// Make CHUNK_SIZE accessible from outside
InfiniteGrid.CHUNK_SIZE = GRID_CONFIG.CHUNK_SIZE;