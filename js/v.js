fetch("./hash.txt")
    .then(response => {
        if (!response.ok) throw new Error('Network response was not ok');
        return response.text();
    })
    .then(commitHash => {
        const trimmedHash = commitHash.trim();
        if (trimmedHash.length > 0 && trimmedHash.length <= 100) {
            document.getElementById("commit-hash-btn").textContent = trimmedHash;
            console.log("Commit hash: " + trimmedHash);
        } else {
            document.getElementById("commit-hash-btn").textContent = "development";
            console.warn("Invalid hash format");
        }
    })
    .catch(err => {
        console.error("Failed to load version hash:", err);
        document.getElementById("commit-hash-btn").textContent = "development";
    });
