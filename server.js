const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3000;

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '10mb' }));

const dataPath = path.join(__dirname, 'data', 'songs.json');

// Get all songs
app.get('/api/songs', (req, res) => {
    fs.readFile(dataPath, 'utf8', (err, data) => {
        if (err) return res.status(500).json({ error: 'Failed to read data' });
        res.json(JSON.parse(data));
    });
});

// Add new song with status 'pending'
app.post('/api/songs', (req, res) => {
    fs.readFile(dataPath, 'utf8', (err, data) => {
        if (err) return res.status(500).json({ error: 'Failed to read data' });
        
        const songs = JSON.parse(data);
        const newSong = req.body;
        
        newSong.id = songs.length ? Math.max(...songs.map(s => s.id)) + 1 : 1;
        newSong.status = "pending";
        if (!newSong.bpm) newSong.bpm = 116;
        
        songs.push(newSong);
        
        fs.writeFile(dataPath, JSON.stringify(songs, null, 2), (err) => {
            if (err) return res.status(500).json({ error: 'Failed to save song' });
            res.json(newSong);
        });
    });
});

app.listen(PORT, () => {
    console.log(`GITARPLK (Songsterr Clone) is running on http://localhost:${PORT}`);
});