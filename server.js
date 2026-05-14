const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();

app.use(cors({
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true
}));

app.use(express.json({
    limit: "50mb"
}));

const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    transports: ["websocket", "polling"]
});

// ================= MEMORY DATABASE =================
let users = [];
let groups = {};
let privateMessages = {};
let groupMessages = {};
let onlineUsers = {};

const GROUP_TIMEOUT = 30 * 60 * 1000;

// ================= TEST ROUTE =================
app.get("/", (req, res) => {
    res.send("Rovii Backend Running");
});

// ================= REGISTER =================
app.post("/api/register", (req, res) => {
    try {
        const { username, password, motherName, fatherName } = req.body;

        if (!username || !password) {
            return res.json({
                success: false,
                message: "Missing username/password"
            });
        }

        const cleanUsername = username.trim();

        const exists = users.find(
            u => u.username.toLowerCase() === cleanUsername.toLowerCase()
        );

        if (exists) {
            return res.json({
                success: false,
                message: "Username already exists"
            });
        }

        users.push({
            username: cleanUsername,
            password,
            motherName: motherName || "",
            fatherName: fatherName || "",
            profilePic: "",
            friends: [],
            friendRequests: []
        });

        res.json({
            success: true
        });

    } catch (err) {
        console.log("Register error:", err);
        res.status(500).json({
            success: false,
            message: "Server error"
        });
    }
});

// ================= LOGIN =================
app.post("/api/login", (req, res) => {
    try {
        const { username, password } = req.body;

        const user = users.find(
            u =>
                u.username.toLowerCase() === String(username || "").toLowerCase() &&
                u.password === password
        );

        if (!user) {
            return res.json({
                success: false,
                message: "Invalid username or password"
            });
        }

        res.json({
            success: true,
            username: user.username,
            profilePic: user.profilePic || "",
            sessionId: Date.now().toString() + Math.random().toString(36).slice(2)
        });

    } catch (err) {
        console.log("Login error:", err);
        res.status(500).json({
            success: false,
            message: "Server error"
        });
    }
});

// ================= VERIFY SESSION BASIC =================
app.post("/api/verify", (req, res) => {
    const { username } = req.body || {};

    const user = users.find(u => u.username === username);

    if (!user) {
        return res.json({
            valid: false
        });
    }

    res.json({
        valid: true,
        username: user.username,
        profilePic: user.profilePic || ""
    });
});

// ================= FORGOT PASSWORD =================
app.post("/api/forgot-password", (req, res) => {
    try {
        const { username, motherName, fatherName, newPassword } = req.body;

        const user = users.find(
            u =>
                u.username.toLowerCase() === String(username || "").toLowerCase() &&
                u.motherName.toLowerCase() === String(motherName || "").toLowerCase() &&
                u.fatherName.toLowerCase() === String(fatherName || "").toLowerCase()
        );

        if (!user) {
            return res.json({
                success: false,
                message: "Security details not matched"
            });
        }

        if (!newPassword || newPassword.length < 4) {
            return res.json({
                success: false,
                message: "New password must be minimum 4 chars"
            });
        }

        user.password = newPassword;

        res.json({
            success: true
        });

    } catch (err) {
        console.log("Forgot password error:", err);
        res.status(500).json({
            success: false,
            message: "Server error"
        });
    }
});

// ================= UPDATE USERNAME =================
app.post("/api/update-username", (req, res) => {
    const { oldUsername, newUsername, password } = req.body;

    const user = users.find(u => u.username === oldUsername);

    if (!user || user.password !== password) {
        return res.json({
            success: false,
            message: "Wrong password"
        });
    }

    const exists = users.find(
        u => u.username.toLowerCase() === String(newUsername || "").toLowerCase()
    );

    if (exists) {
        return res.json({
            success: false,
            message: "Username already exists"
        });
    }

    user.username = newUsername;

    res.json({
        success: true
    });
});

// ================= UPDATE PASSWORD =================
app.post("/api/update-password", (req, res) => {
    const { username, oldPassword, newPassword } = req.body;

    const user = users.find(u => u.username === username);

    if (!user || user.password !== oldPassword) {
        return res.json({
            success: false,
            message: "Wrong current password"
        });
    }

    user.password = newPassword;

    res.json({
        success: true
    });
});

// ================= PROFILE PIC =================
app.post("/api/upload-pic", (req, res) => {
    try {
        const { username, imageData } = req.body;

        const user = users.find(u => u.username === username);

        if (!user) {
            return res.json({
                success: false,
                message: "User not found"
            });
        }

        user.profilePic = imageData || "";

        res.json({
            success: true
        });

    } catch (err) {
        console.log("Upload pic error:", err);
        res.status(500).json({
            success: false,
            message: "Image too large or server error"
        });
    }
});

app.get("/api/get-pic", (req, res) => {
    const username = req.query.username;

    const user = users.find(u => u.username === username);

    res.json({
        profilePic: user?.profilePic || ""
    });
});

// ================= FRIENDS =================
app.get("/api/friends", (req, res) => {
    const username = req.query.username;

    const user = users.find(u => u.username === username);

    res.json({
        friends: user?.friends || []
    });
});

app.get("/api/friend-requests", (req, res) => {
    const username = req.query.username;

    const user = users.find(u => u.username === username);

    res.json({
        requests: user?.friendRequests || []
    });
});

app.get("/user-exists", (req, res) => {
    const username = req.query.username;

    const exists = users.find(
        u => u.username.toLowerCase() === String(username || "").toLowerCase()
    );

    res.json({
        exists: !!exists
    });
});

app.post("/api/send-friend-request", (req, res) => {
    const { from, to } = req.body;

    if (!from || !to || from === to) {
        return res.json({
            success: false,
            message: "Invalid request"
        });
    }

    const sender = users.find(u => u.username === from);
    const target = users.find(u => u.username === to);

    if (!sender || !target) {
        return res.json({
            success: false,
            message: "User not found"
        });
    }

    if (sender.friends.includes(to)) {
        return res.json({
            success: false,
            message: "Already friends"
        });
    }

    if (!target.friendRequests.includes(from)) {
        target.friendRequests.push(from);
    }

    res.json({
        success: true
    });
});

app.post("/api/accept-friend", (req, res) => {
    const { from, to } = req.body;

    const sender = users.find(u => u.username === from);
    const receiver = users.find(u => u.username === to);

    if (!sender || !receiver) {
        return res.json({
            success: false,
            message: "User not found"
        });
    }

    if (!sender.friends.includes(to)) {
        sender.friends.push(to);
    }

    if (!receiver.friends.includes(from)) {
        receiver.friends.push(from);
    }

    receiver.friendRequests = receiver.friendRequests.filter(r => r !== from);

    if (onlineUsers[from]) {
        io.to(onlineUsers[from]).emit("friend-request-accepted", {
            by: to
        });
    }

    res.json({
        success: true
    });
});

app.post("/api/reject-friend", (req, res) => {
    const { from, to } = req.body;

    const user = users.find(u => u.username === to);

    if (user) {
        user.friendRequests = user.friendRequests.filter(r => r !== from);
    }

    res.json({
        success: true
    });
});

app.post("/api/remove-friend", (req, res) => {
    const { user1, user2 } = req.body;

    const u1 = users.find(u => u.username === user1);
    const u2 = users.find(u => u.username === user2);

    if (u1) {
        u1.friends = u1.friends.filter(f => f !== user2);
    }

    if (u2) {
        u2.friends = u2.friends.filter(f => f !== user1);
    }

    res.json({
        success: true
    });
});

// ================= PRIVATE MESSAGES =================
app.post("/api/send-private-message", (req, res) => {
    const { from, to, text, time } = req.body;

    const key = [from, to].sort().join("_");

    if (!privateMessages[key]) {
        privateMessages[key] = [];
    }

    privateMessages[key].push({
        from_user: from,
        to_user: to,
        text,
        time: time || new Date().toLocaleTimeString(),
        createdAt: Date.now()
    });

    res.json({
        success: true
    });
});

app.get("/api/private-messages", (req, res) => {
    const { user1, user2 } = req.query;

    const key = [user1, user2].sort().join("_");

    res.json({
        messages: privateMessages[key] || []
    });
});

// ================= SOCKET =================
io.on("connection", (socket) => {
    console.log("Socket connected:", socket.id);

    socket.on("register-user", ({ username }) => {
        socket.username = username;
        onlineUsers[username] = socket.id;
    });

    socket.on("create-group", ({ userId }) => {
        const groupId = Math.random().toString(36).substring(2, 10);

        groups[groupId] = {
            admin: userId,
            users: [userId],
            lastActive: Date.now()
        };

        groupMessages[groupId] = [];

        socket.join(groupId);
        socket.currentGroup = groupId;

        socket.emit("group-created", groupId);
        socket.emit("admin-status", true);

        io.to(groupId).emit("online-users", groups[groupId].users);
    });

    socket.on("join-group", ({ groupId, userId }) => {
        if (!groups[groupId]) {
            socket.emit("group-error", {
                message: "Group not found or expired"
            });
            return;
        }

        groups[groupId].lastActive = Date.now();

        if (!groups[groupId].users.includes(userId)) {
            groups[groupId].users.push(userId);
        }

        socket.join(groupId);
        socket.currentGroup = groupId;

        socket.emit("joined-group", groupId);
        socket.emit("admin-status", groups[groupId].admin === userId);
        socket.emit("old-messages", groupMessages[groupId] || []);

        io.to(groupId).emit("online-users", groups[groupId].users);
    });

    socket.on("rejoin-group", ({ groupId, userId }) => {
        if (!groups[groupId]) return;

        groups[groupId].lastActive = Date.now();

        if (!groups[groupId].users.includes(userId)) {
            groups[groupId].users.push(userId);
        }

        socket.join(groupId);
        socket.currentGroup = groupId;

        socket.emit("admin-status", groups[groupId].admin === userId);
        socket.emit("old-messages", groupMessages[groupId] || []);
        io.to(groupId).emit("online-users", groups[groupId].users);
    });

    socket.on("send-message", ({ groupId, msg }) => {
        if (!groups[groupId]) return;

        groups[groupId].lastActive = Date.now();

        if (!groupMessages[groupId]) {
            groupMessages[groupId] = [];
        }

        const savedMsg = {
            ...msg,
            time: msg.time || new Date().toLocaleTimeString(),
            createdAt: Date.now()
        };

        groupMessages[groupId].push(savedMsg);

        socket.to(groupId).emit("new-message", savedMsg);
    });

    socket.on("play-video", ({ groupId, videoId }) => {
        if (!groups[groupId]) return;

        groups[groupId].lastActive = Date.now();

        socket.to(groupId).emit("sync-video", {
            videoId
        });
    });

    socket.on("private-message", (data) => {
        if (!data || !data.to || !data.from) return;

        if (onlineUsers[data.to]) {
            io.to(onlineUsers[data.to]).emit("private-message", data);
        }
    });

    socket.on("profile-pic-updated", (data) => {
        socket.broadcast.emit("profile-pic-updated", data);
    });

    socket.on("friend-accepted", ({ from, to }) => {
        if (onlineUsers[from]) {
            io.to(onlineUsers[from]).emit("friend-request-accepted", {
                by: to
            });
        }
    });

    socket.on("leave-group", ({ groupId, userId }) => {
        if (!groups[groupId]) return;

        groups[groupId].users = groups[groupId].users.filter(u => u !== userId);
        groups[groupId].lastActive = Date.now();

        socket.leave(groupId);
        socket.currentGroup = null;

        if (groups[groupId].users.length === 0) {
            delete groups[groupId];
            delete groupMessages[groupId];
            return;
        }

        io.to(groupId).emit("online-users", groups[groupId].users);
    });

    socket.on("close-group", ({ groupId, userId }) => {
        if (!groups[groupId]) return;

        if (groups[groupId].admin !== userId) {
            return;
        }

        io.to(groupId).emit("group-closed");

        delete groups[groupId];
        delete groupMessages[groupId];
    });

    socket.on("disconnect", () => {
        if (socket.username && onlineUsers[socket.username] === socket.id) {
            delete onlineUsers[socket.username];
        }

        console.log("Socket disconnected:", socket.id);
    });
});

// ================= AUTO DELETE INACTIVE GROUPS =================
setInterval(() => {
    const now = Date.now();

    Object.keys(groups).forEach(groupId => {
        const group = groups[groupId];

        if (now - group.lastActive > GROUP_TIMEOUT) {
            io.to(groupId).emit("group-closed");

            delete groups[groupId];
            delete groupMessages[groupId];

            console.log("Deleted inactive group:", groupId);
        }
    });
}, 60 * 1000);

// ================= CLEAN OLD PRIVATE MSGS OPTIONAL 7 DAYS =================
setInterval(() => {
    const now = Date.now();
    const sevenDays = 7 * 24 * 60 * 60 * 1000;

    Object.keys(privateMessages).forEach(key => {
        privateMessages[key] = privateMessages[key].filter(
            m => now - (m.createdAt || now) < sevenDays
        );
    });
}, 60 * 60 * 1000);

// ================= START =================
const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
    console.log("Server running on port " + PORT);
});
