fetch("./hash.txt").then(response => response.text()).then(commitHash => {
    document.getElementById("commit-hash-btn").textContent = "v." + commitHash;
    console.log("Commit hash: " + commitHash);
}).catch(err => {
    console.error("Failed to load version hash:", err);
});
