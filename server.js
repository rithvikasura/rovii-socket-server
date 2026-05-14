const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();

app.use(cors({
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true
}));

app.use(express.json({
    limit: '50mb'
}));

const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    transports: ['websocket', 'polling']
});

// ================= DATABASE =================
let users = [];
let groups = {};
let privateMessages = {};
let groupMessages = {};

// ================= TEST =================
app.get('/', (req, res) => {
    res.send("Rovii Backend Running");
});

// ================= REGISTER =================
app.post('/api/register', (req, res) => {

    try {

        const {
            username,
            password,
            motherName,
            fatherName
        } = req.body;

        if(!username || !password) {
            return res.json({
                success:false,
                message:"Missing fields"
            });
        }

        const exists = users.find(
            u => u.username === username
        );

        if(exists) {
            return res.json({
                success:false,
                message:"Username already exists"
            });
        }

        users.push({
            username,
            password,
            motherName,
            fatherName,
            profilePic:"",
            friends:[],
            friendRequests:[]
        });

        res.json({
            success:true
        });

    } catch(err) {

        console.log(err);

        res.status(500).json({
            success:false,
            message:"Server error"
        });

    }

});

// ================= LOGIN =================
app.post('/api/login', (req, res) => {

    try {

        const {
            username,
            password
        } = req.body;

        const user = users.find(
            u =>
            u.username === username &&
            u.password === password
        );

        if(!user) {
            return res.json({
                success:false,
                message:"Invalid credentials"
            });
        }

        res.json({
            success:true,
            sessionId: Date.now().toString()
        });

    } catch(err) {

        console.log(err);

        res.status(500).json({
            success:false
        });

    }

});

// ================= FORGOT PASSWORD =================
app.post('/api/forgot-password', (req, res) => {

    try {

        const {
            username,
            motherName,
            fatherName,
            newPassword
        } = req.body;

        const user = users.find(
            u =>
            u.username === username &&
            u.motherName === motherName &&
            u.fatherName === fatherName
        );

        if(!user) {
            return res.json({
                success:false,
                message:"Details not matched"
            });
        }

        user.password = newPassword;

        res.json({
            success:true
        });

    } catch(err) {

        res.status(500).json({
            success:false
        });

    }

});

// ================= PROFILE PIC =================
app.post('/api/upload-pic', (req, res) => {

    try {

        const {
            username,
            imageData
        } = req.body;

        const user = users.find(
            u => u.username === username
        );

        if(!user) {
            return res.json({
                success:false
            });
        }

        user.profilePic = imageData;

        res.json({
            success:true
        });

    } catch(err) {

        res.status(500).json({
            success:false
        });

    }

});

app.get('/api/get-pic', (req, res) => {

    const username = req.query.username;

    const user = users.find(
        u => u.username === username
    );

    res.json({
        profilePic: user?.profilePic || ""
    });

});

// ================= FRIENDS =================
app.get('/api/friends', (req, res) => {

    const username = req.query.username;

    const user = users.find(
        u => u.username === username
    );

    res.json({
        friends: user?.friends || []
    });

});

// ================= FRIEND REQUESTS =================
app.get('/api/friend-requests', (req, res) => {

    const username = req.query.username;

    const user = users.find(
        u => u.username === username
    );

    res.json({
        requests: user?.friendRequests || []
    });

});

// ================= USER EXISTS =================
app.get('/user-exists', (req, res) => {

    const username = req.query.username;

    const exists = users.find(
        u => u.username === username
    );

    res.json({
        exists: !!exists
    });

});

// ================= SEND FRIEND REQUEST =================
app.post('/api/send-friend-request', (req, res) => {

    const { from, to } = req.body;

    const target = users.find(
        u => u.username === to
    );

    if(!target) {
        return res.json({
            success:false,
            message:"User not found"
        });
    }

    if(!target.friendRequests.includes(from)) {
        target.friendRequests.push(from);
    }

    res.json({
        success:true
    });

});

// ================= ACCEPT FRIEND =================
app.post('/api/accept-friend', (req, res) => {

    const { from, to } = req.body;

    const user1 = users.find(
        u => u.username === from
    );

    const user2 = users.find(
        u => u.username === to
    );

    if(user1 && user2) {

        if(!user1.friends.includes(to)) {
            user1.friends.push(to);
        }

        if(!user2.friends.includes(from)) {
            user2.friends.push(from);
        }

        user2.friendRequests =
            user2.friendRequests.filter(
                r => r !== from
            );

    }

    res.json({
        success:true
    });

});

// ================= REJECT FRIEND =================
app.post('/api/reject-friend', (req, res) => {

    const { from, to } = req.body;

    const user = users.find(
        u => u.username === to
    );

    if(user) {

        user.friendRequests =
            user.friendRequests.filter(
                r => r !== from
            );

    }

    res.json({
        success:true
    });

});

// ================= REMOVE FRIEND =================
app.post('/api/remove-friend', (req, res) => {

    const { user1, user2 } = req.body;

    const u1 = users.find(
        u => u.username === user1
    );

    const u2 = users.find(
        u => u.username === user2
    );

    if(u1) {
        u1.friends =
            u1.friends.filter(f => f !== user2);
    }

    if(u2) {
        u2.friends =
            u2.friends.filter(f => f !== user1);
    }

    res.json({
        success:true
    });

});

// ================= PRIVATE MESSAGE =================
app.post('/api/send-private-message', (req, res) => {

    const {
        from,
        to,
        text,
        time
    } = req.body;

    const key = [from, to].sort().join("_");

    if(!privateMessages[key]) {
        privateMessages[key] = [];
    }

    privateMessages[key].push({
        from_user: from,
        to_user: to,
        text,
        time
    });

    res.json({
        success:true
    });

});

app.get('/api/private-messages', (req, res) => {

    const {
        user1,
        user2
    } = req.query;

    const key = [user1, user2]
        .sort()
        .join("_");

    res.json({
        messages: privateMessages[key] || []
    });

});

// ================= SOCKET =================
io.on('connection', (socket) => {

    console.log("User connected");

    socket.on('register-user', ({ username }) => {

        socket.username = username;

    });

    socket.on('create-group', ({ userId }) => {

        const groupId =
            Math.random()
            .toString(36)
            .substring(2, 10);

        groups[groupId] = {
            admin: userId,
            users: [userId]
        };

        groupMessages[groupId] = [];

        socket.join(groupId);

        socket.currentGroup = groupId;

        socket.emit('group-created', groupId);

        socket.emit('admin-status', true);

        io.to(groupId).emit(
            'online-users',
            groups[groupId].users
        );

    });

    socket.on('join-group', ({ groupId, userId }) => {

        if(!groups[groupId]) {
            return;
        }

        if(!groups[groupId].users.includes(userId)) {
            groups[groupId].users.push(userId);
        }

        socket.join(groupId);

        socket.currentGroup = groupId;

        socket.emit('joined-group', groupId);

        socket.emit(
            'admin-status',
            groups[groupId].admin === userId
        );

        socket.emit(
            'old-messages',
            groupMessages[groupId] || []
        );

        io.to(groupId).emit(
            'online-users',
            groups[groupId].users
        );

    });

    socket.on('rejoin-group', ({ groupId, userId }) => {

        if(groups[groupId]) {

            socket.join(groupId);

            socket.currentGroup = groupId;

            if(!groups[groupId].users.includes(userId)) {
                groups[groupId].users.push(userId);
            }

            socket.emit(
                'old-messages',
                groupMessages[groupId] || []
            );

            io.to(groupId).emit(
                'online-users',
                groups[groupId].users
            );

        }

    });

    socket.on('send-message', ({ groupId, msg }) => {

        if(!groupMessages[groupId]) {
            groupMessages[groupId] = [];
        }

        groupMessages[groupId].push(msg);

        socket.to(groupId)
        .emit('new-message', msg);

    });

    socket.on('play-video', ({ groupId, videoId }) => {

        socket.to(groupId)
        .emit('sync-video', {
            videoId
        });

    });

    socket.on('private-message', (data) => {

        io.emit('private-message', data);

    });

    socket.on('leave-group', ({ groupId, userId }) => {

        if(groups[groupId]) {

            groups[groupId].users =
                groups[groupId].users.filter(
                    u => u !== userId
                );

            io.to(groupId).emit(
                'online-users',
                groups[groupId].users
            );

        }

    });

    socket.on('close-group', ({ groupId }) => {

        io.to(groupId).emit(
            'group-closed'
        );

        delete groups[groupId];

    });

});

// ================= START =================
const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {

    console.log("Server running on port " + PORT);

});
