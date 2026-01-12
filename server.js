const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'database.json');

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(express.static(path.join(__dirname, 'public')));

const agent = new https.Agent({ rejectUnauthorized: false });

function getData() {
    try {
        if (!fs.existsSync(DB_FILE)) {
            const initial = { 
                users: [{ username: "marten", password: "0524273202", role: "admin" }], 
                parts: [],
                resetRequests: [] 
            };
            fs.writeFileSync(DB_FILE, JSON.stringify(initial, null, 2));
            return initial;
        }
        
        const data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
        if (!data.resetRequests) {
            data.resetRequests = [];
            saveData(data);
        }
        return data;
    } catch (e) { 
        return { users: [], parts: [], resetRequests: [] }; 
    }
}

function saveData(data) { fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2)); }

// --- ניתובי דפים ---
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

// --- API משתמשים ---
app.get('/api/users', (req, res) => res.json(getData().users));

app.post('/api/users/create', (req, res) => {
    const db = getData();
    const { username, password, role } = req.body;
    if (db.users.find(u => u.username === username)) return res.status(400).json({ success: false, msg: "User exists" });
    db.users.push({ username, password, role });
    saveData(db);
    res.json({ success: true });
});

app.delete('/api/users/:name', (req, res) => {
    let db = getData();
    if (req.params.name === 'marten') return res.status(403).json({ success: false });
    db.users = db.users.filter(u => u.username !== req.params.name);
    saveData(db);
    res.json({ success: true });
});

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    const db = getData();
    const user = db.users.find(u => u.username === username && u.password === password);
    
    if (user) {
        if (user.mustChangePassword) {
            return res.json({ success: true, requireNewPassword: true, username: user.username });
        }
        res.json({ success: true, role: user.role, username: user.username });
    } else {
        res.status(401).json({ success: false });
    }
});

app.post('/api/users/change-password', (req, res) => {
    const { username, newPassword } = req.body;
    const db = getData();
    const index = db.users.findIndex(u => u.username === username);

    if (index !== -1) {
        db.users[index].password = newPassword;
        db.users[index].mustChangePassword = false;
        saveData(db);
        res.json({ success: true, role: db.users[index].role });
    } else {
        res.status(400).json({ success: false });
    }
});

// --- API איפוס סיסמה ---
app.post('/api/password-reset/request', (req, res) => {
    const { username } = req.body;
    const db = getData();
    const user = db.users.find(u => u.username === username);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    if (!db.resetRequests.includes(username)) {
        db.resetRequests.push(username);
        saveData(db);
    }
    res.json({ success: true, message: "Reset requested" });
});

app.get('/api/reset-requests', (req, res) => res.json(getData().resetRequests || []));

app.post('/api/reset-requests/handle', (req, res) => {
    const { username, action } = req.body;
    const db = getData();

    if (db.resetRequests) db.resetRequests = db.resetRequests.filter(u => u !== username);

    if (action === 'approve') {
        const userIndex = db.users.findIndex(u => u.username === username);
        if (userIndex !== -1) {
            db.users[userIndex].allowManualReset = true; 
        }
    }

    saveData(db);
    res.json({ success: true });
});

app.post('/api/users/complete-reset', (req, res) => {
    const { username, newPassword } = req.body;
    const db = getData();
    const userIndex = db.users.findIndex(u => u.username === username);

    if (userIndex !== -1 && db.users[userIndex].allowManualReset) {
        db.users[userIndex].password = newPassword;
        db.users[userIndex].allowManualReset = false;
        saveData(db);
        res.json({ success: true });
    } else {
        res.status(403).json({ success: false, message: "אין אישור החלפה" });
    }
});

// --- API חלפים וחיפוש ---
app.get('/api/parts', (req, res) => res.json(getData().parts));

app.post('/api/parts/add', (req, res) => {
    const db = getData();
    db.parts.push({ ...req.body, id: Date.now() });
    saveData(db);
    res.json({ success: true });
});

// --- כאן הוספנו את החלק החסר: עריכת פריט ---
app.put('/api/parts/:id', (req, res) => {
    const partId = parseInt(req.params.id);
    const updatedData = req.body;
    const db = getData();
    
    const index = db.parts.findIndex(p => p.id === partId);
    if (index !== -1) {
        // מעדכנים את השדות אבל שומרים על ה-ID המקורי
        db.parts[index] = { ...updatedData, id: partId };
        saveData(db);
        res.json({ success: true });
    } else {
        res.status(404).json({ success: false, message: "Part not found" });
    }
});
// ------------------------------------------

app.delete('/api/parts/:id', (req, res) => {
    let db = getData();
    db.parts = db.parts.filter(p => p.id !== parseInt(req.params.id));
    saveData(db);
    res.json({ success: true });
});

app.get('/api/search', async (req, res) => {
    const { vin } = req.query;
    try {
        const url = `https://data.gov.il/api/3/action/datastore_search?resource_id=053cea08-09bc-40ec-8f7a-156f0677aff3&q=${vin}`;
        const response = await axios.get(url, { httpsAgent: agent });
        const car = response.data.result.records[0];

        if (car) {
            const db = getData();
            const carMake = (car.tozar || car.tozeret_nm || "").trim();
            const carYear = parseInt(car.shnat_yitzur);

            const matchedParts = db.parts.filter(p => {
                const makeMatch = carMake.toLowerCase().includes(p.make.toLowerCase()) || 
                                  p.make.toLowerCase().includes(carMake.toLowerCase());
                const yearMatch = carYear >= parseInt(p.yearFrom) && carYear <= parseInt(p.yearTo);
                return makeMatch && yearMatch;
            });

            res.json({ 
                success: true, 
                carData: { 
                    make: carMake, 
                    model: (car.kinuy_mishari || car.degem_nm || "").trim(), 
                    year: carYear, 
                    plate: car.mispar_rechev 
                }, 
                parts: matchedParts 
            });
        } else res.json({ success: false });
    } catch (e) { res.status(500).json({ success: false }); }
});

app.listen(PORT, () => console.log(`🚀 Server running: http://localhost:${PORT}`));