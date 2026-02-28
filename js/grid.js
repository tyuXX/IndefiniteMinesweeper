class Tile {
    constructor() {
        this.isMine = false;
        this.isRevealed = false;
        this.isFlagged = false;
        this.adjacentMines = 0;
    }
}

class Grid16X16 {
    constructor(hardness) {
        this.grid = [];
        this.initGrid();
        this.generateMines(hardness);
    }

    initGrid() {
        for (let i = 0; i < 16; i++) {
            this.grid[i] = [];
            for (let j = 0; j < 16; j++) {
                this.grid[i][j] = new Tile();
            }
        }
    }

    generateMines(hardness) {
        if (hardness > 50) {
            hardness = 50;
        }
        let mines = Math.floor(hardness * 16 * 16 / 100);
        for (let i = 0; i < mines; i++) {
            let x = Math.floor(Math.random() * 16);
            let y = Math.floor(Math.random() * 16);
            if (this.grid[x][y].isMine) {
                i--;
                continue;
            }
            this.grid[x][y].isMine = true;
        }
    }

    calculateAdjacentMines(x, y) {
        let mines = 0;
        for (let i = -1; i <= 1; i++) {
            for (let j = -1; j <= 1; j++) {
                try {
                    if (this.grid[x + i][y + j].isMine) {
                        mines++;
                    }
                } catch (e) {
                    continue;
                }
            }
        }
        this.grid[x][y].adjacentMines = mines;
    }

    isComplete() {
        for (let i = 0; i < 16; i++) {
            for (let j = 0; j < 16; j++) {
                if (!this.grid[i][j].isRevealed && !this.grid[i][j].isFlagged) {
                    return false;
                }
            }
        }
        return true;
    }
}

class GameIndefinite {
    constructor() {
        this.grids = [];
        this.grids[0] = [];
        this.grids[0][0] = new Grid16X16(10);
        this.minesBlown = 0;
        this.completeGrids = 0;
        this.timer = 0;
    }

    getGrid(gridx, gridy) {
        if (this.grids[gridx][gridy] == undefined) {
            this.generateGrid(gridx, gridy);
        }
        return this.grids[gridx][gridy];
    }

    generateGrid(gridx, gridy) {
        let hardness = Math.sqrt((gridx - 7.5) ** 2 + (gridy - 7.5) ** 2) * 50 * Math.min(Math.random(), 0.5);
        this.grids[gridx][gridy] = new Grid16X16(hardness);
        this.grids[gridx][gridy].initGrid();
        this.grids[gridx][gridy].generateMines(hardness);
    }

    revealTile(gridx, gridy, x, y) {
        if (this.getGrid(gridx, gridy).grid[x][y].isRevealed) {
            return;
        }
        this.getGrid(gridx, gridy).grid[x][y].isRevealed = true;
        if (this.getGrid(gridx, gridy).grid[x][y].isMine) {
            this.minesBlown++;
            return;
        }
        if (this.getGrid(gridx, gridy).grid[x][y].isFlagged) {
            return;
        }
        if (this.getGrid(gridx, gridy).grid[x][y].adjacentMines == 0) {
            for (let i = -1; i <= 1; i++) {
                for (let j = -1; j <= 1; j++) {
                    try {
                        this.revealTile(gridx, gridy, x + i, y + j);
                    } catch (e) {
                        continue;
                    }
                }
            }
        }
        // Check if grid is complete
        if (this.getGrid(gridx, gridy).isComplete()) {
            this.completeGrids++;
            this.grids[gridx][gridy] = true;
        }
    }
}