const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");

const app = express();

app.use(cors({
  origin: "*",
  methods: ["GET", "POST"]
}));

app.use(express.json({ limit: "50mb" }));

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  transports: ["websocket", "polling"]
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

let onlineUsers = {};
const GROUP_TIMEOUT_MINUTES = 30;

app.get("/", (req, res) => {
  res.send("Rovii Backend Running with Supabase");
});

function makeSessionId() {
  return Date.now().toString() + Math.random().toString(36).slice(2);
}

function makeGroupId() {
  return Math.random().toString(36).substring(2, 10);
}

async function getGroupMembers(groupId) {
  const { data } = await supabase
    .from("group_members")
    .select("username")
    .eq("group_id", groupId);

  return (data || []).map(x => x.username);
}

async function deleteGroup(groupId) {
  io.to(groupId).emit("group-closed");

  const room = io.sockets.adapter.rooms.get(groupId);
  if (room) {
    room.forEach(socketId => {
      const s = io.sockets.sockets.get(socketId);
      if (s) {
        s.leave(groupId);
        s.currentGroup = null;
      }
    });
  }

  await supabase.from("groups").delete().eq("id", groupId);
}

// ================= AUTH =================

app.post("/api/register", async (req, res) => {
  try {
    const { username, password, motherName, fatherName } = req.body;
    if (!username || !password) {
      return res.json({ success: false, message: "Missing fields" });
    }

    const clean = username.trim();

    const { data: existing } = await supabase
      .from("users")
      .select("username")
      .ilike("username", clean)
      .maybeSingle();

    if (existing) {
      return res.json({ success: false, message: "Username already exists" });
    }

    const { error } = await supabase.from("users").insert({
      username: clean,
      password,
      mother_name: motherName || "",
      father_name: fatherName || "",
      profile_pic: ""
    });

    if (error) throw error;

    res.json({ success: true });
  } catch (err) {
    console.log("Register error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

app.post("/api/login", async (req, res) => {
  try {
    const { username, password } = req.body;

    const { data: user, error } = await supabase
      .from("users")
      .select("*")
      .ilike("username", username || "")
      .eq("password", password || "")
      .maybeSingle();

    if (error) throw error;

    if (!user) {
      return res.json({ success: false, message: "Invalid username or password" });
    }

    const sessionId = makeSessionId();

    await supabase.from("sessions").insert({
      session_id: sessionId,
      username: user.username
    });

    res.json({
      success: true,
      username: user.username,
      profilePic: user.profile_pic || "",
      sessionId
    });
  } catch (err) {
    console.log("Login error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

app.post("/api/verify", async (req, res) => {
  try {
    const { sessionId } = req.body;

    const { data: session } = await supabase
      .from("sessions")
      .select("username")
      .eq("session_id", sessionId)
      .maybeSingle();

    if (!session) return res.json({ valid: false });

    const { data: user } = await supabase
      .from("users")
      .select("username, profile_pic")
      .eq("username", session.username)
      .maybeSingle();

    if (!user) return res.json({ valid: false });

    res.json({
      valid: true,
      username: user.username,
      profilePic: user.profile_pic || ""
    });
  } catch {
    res.json({ valid: false });
  }
});

app.post("/api/logout", async (req, res) => {
  const { sessionId } = req.body;
  if (sessionId) {
    await supabase.from("sessions").delete().eq("session_id", sessionId);
  }
  res.json({ success: true });
});

app.post("/api/forgot-password", async (req, res) => {
  try {
    const { username, motherName, fatherName, newPassword } = req.body;

    const { data: user } = await supabase
      .from("users")
      .select("*")
      .ilike("username", username || "")
      .ilike("mother_name", motherName || "")
      .ilike("father_name", fatherName || "")
      .maybeSingle();

    if (!user) {
      return res.json({ success: false, message: "Security details not matched" });
    }

    await supabase
      .from("users")
      .update({ password: newPassword })
      .eq("username", user.username);

    res.json({ success: true });
  } catch (err) {
    console.log("Forgot error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// ================= PROFILE =================

app.post("/api/upload-pic", async (req, res) => {
  try {
    const { username, imageData } = req.body;

    const { error } = await supabase
      .from("users")
      .update({ profile_pic: imageData || "" })
      .eq("username", username);

    if (error) throw error;

    res.json({ success: true });
  } catch (err) {
    console.log("Pic error:", err);
    res.status(500).json({ success: false, message: "Upload failed" });
  }
});

app.get("/api/get-pic", async (req, res) => {
  const { username } = req.query;

  const { data } = await supabase
    .from("users")
    .select("profile_pic")
    .eq("username", username)
    .maybeSingle();

  res.json({ profilePic: data?.profile_pic || "" });
});

// ================= FRIENDS =================

app.get("/user-exists", async (req, res) => {
  const { username } = req.query;

  const { data } = await supabase
    .from("users")
    .select("username")
    .ilike("username", username || "")
    .maybeSingle();

  res.json({ exists: !!data });
});

app.get("/api/friends", async (req, res) => {
  const { username } = req.query;

  const { data } = await supabase
    .from("friends")
    .select("*")
    .or(`user1.eq.${username},user2.eq.${username}`);

  const friends = (data || []).map(f => f.user1 === username ? f.user2 : f.user1);

  res.json({ friends });
});

app.get("/api/friend-requests", async (req, res) => {
  const { username } = req.query;

  const { data } = await supabase
    .from("friend_requests")
    .select("from_user")
    .eq("to_user", username)
    .eq("status", "pending");

  res.json({ requests: (data || []).map(r => r.from_user) });
});

app.post("/api/send-friend-request", async (req, res) => {
  try {
    const { from, to } = req.body;

    if (!from || !to || from === to) {
      return res.json({ success: false, message: "Invalid request" });
    }

    const { data: target } = await supabase
      .from("users")
      .select("username")
      .eq("username", to)
      .maybeSingle();

    if (!target) {
      return res.json({ success: false, message: "User not found" });
    }

    const { data: alreadyFriend } = await supabase
      .from("friends")
      .select("*")
      .or(`and(user1.eq.${from},user2.eq.${to}),and(user1.eq.${to},user2.eq.${from})`)
      .maybeSingle();

    if (alreadyFriend) {
      return res.json({ success: false, message: "Already friends" });
    }

    await supabase.from("friend_requests").upsert({
      from_user: from,
      to_user: to,
      status: "pending"
    }, {
      onConflict: "from_user,to_user"
    });

    res.json({ success: true });
  } catch (err) {
    console.log("Friend request error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

app.post("/api/accept-friend", async (req, res) => {
  try {
    const { from, to } = req.body;

    await supabase.from("friends").upsert({
      user1: from,
      user2: to
    }, {
      onConflict: "user1,user2"
    });

    await supabase
      .from("friend_requests")
      .delete()
      .eq("from_user", from)
      .eq("to_user", to);

    if (onlineUsers[from]) {
      io.to(onlineUsers[from]).emit("friend-request-accepted", { by: to });
    }

    res.json({ success: true });
  } catch (err) {
    console.log("Accept friend error:", err);
    res.status(500).json({ success: false });
  }
});

app.post("/api/reject-friend", async (req, res) => {
  const { from, to } = req.body;

  await supabase
    .from("friend_requests")
    .delete()
    .eq("from_user", from)
    .eq("to_user", to);

  res.json({ success: true });
});

app.post("/api/remove-friend", async (req, res) => {
  const { user1, user2 } = req.body;

  await supabase
    .from("friends")
    .delete()
    .or(`and(user1.eq.${user1},user2.eq.${user2}),and(user1.eq.${user2},user2.eq.${user1})`);

  res.json({ success: true });
});

// ================= PRIVATE MESSAGES =================

app.post("/api/send-private-message", async (req, res) => {
  try {
    const { from, to, text, time } = req.body;

    await supabase.from("private_messages").insert({
      from_user: from,
      to_user: to,
      text,
      time: time || new Date().toLocaleTimeString()
    });

    res.json({ success: true });
  } catch (err) {
    console.log("Private msg error:", err);
    res.status(500).json({ success: false });
  }
});

app.get("/api/private-messages", async (req, res) => {
  const { user1, user2 } = req.query;

  const { data } = await supabase
    .from("private_messages")
    .select("*")
    .or(`and(from_user.eq.${user1},to_user.eq.${user2}),and(from_user.eq.${user2},to_user.eq.${user1})`)
    .order("created_at", { ascending: true });

  res.json({ messages: data || [] });
});

// ================= SOCKET =================

io.on("connection", socket => {
  console.log("Socket connected:", socket.id);

  socket.on("register-user", ({ username }) => {
    socket.username = username;
    onlineUsers[username] = socket.id;
  });

  socket.on("create-group", async ({ userId }) => {
    const groupId = makeGroupId();

    await supabase.from("groups").insert({
      id: groupId,
      admin: userId,
      last_activity: new Date().toISOString()
    });

    await supabase.from("group_members").insert({
      group_id: groupId,
      username: userId
    });

    socket.join(groupId);
    socket.currentGroup = groupId;

    socket.emit("group-created", groupId);
    socket.emit("admin-status", true);

    io.to(groupId).emit("online-users", await getGroupMembers(groupId));
  });

  socket.on("join-group", async ({ groupId, userId }) => {
    const { data: group } = await supabase
      .from("groups")
      .select("*")
      .eq("id", groupId)
      .maybeSingle();

    if (!group) {
      socket.emit("group-error", { message: "Group not found or expired" });
      return;
    }

    await supabase
      .from("groups")
      .update({ last_activity: new Date().toISOString() })
      .eq("id", groupId);

    await supabase.from("group_members").upsert({
      group_id: groupId,
      username: userId
    }, {
      onConflict: "group_id,username"
    });

    const { data: oldMsgs } = await supabase
      .from("group_messages")
      .select("*")
      .eq("group_id", groupId)
      .order("created_at", { ascending: true });

    socket.join(groupId);
    socket.currentGroup = groupId;

    socket.emit("joined-group", groupId);
    socket.emit("admin-status", group.admin === userId);
    socket.emit("old-messages", (oldMsgs || []).map(m => ({
      user: m.username,
      text: m.text,
      time: m.time
    })));

    io.to(groupId).emit("online-users", await getGroupMembers(groupId));
  });

  socket.on("rejoin-group", async ({ groupId, userId }) => {
    const { data: group } = await supabase
      .from("groups")
      .select("*")
      .eq("id", groupId)
      .maybeSingle();

    if (!group) {
      socket.emit("group-error", { message: "Group not found or expired" });
      return;
    }

    await supabase.from("group_members").upsert({
      group_id: groupId,
      username: userId
    }, {
      onConflict: "group_id,username"
    });

    const { data: oldMsgs } = await supabase
      .from("group_messages")
      .select("*")
      .eq("group_id", groupId)
      .order("created_at", { ascending: true });

    socket.join(groupId);
    socket.currentGroup = groupId;

    socket.emit("admin-status", group.admin === userId);
    socket.emit("old-messages", (oldMsgs || []).map(m => ({
      user: m.username,
      text: m.text,
      time: m.time
    })));

    io.to(groupId).emit("online-users", await getGroupMembers(groupId));
  });

  socket.on("send-message", async ({ groupId, msg }) => {
    const { data: group } = await supabase
      .from("groups")
      .select("*")
      .eq("id", groupId)
      .maybeSingle();

    if (!group) {
      socket.emit("group-error", { message: "Group not found or expired" });
      return;
    }

    await supabase
      .from("groups")
      .update({ last_activity: new Date().toISOString() })
      .eq("id", groupId);

    const savedMsg = {
      user: msg.user,
      text: msg.text,
      time: msg.time || new Date().toLocaleTimeString()
    };

    await supabase.from("group_messages").insert({
      group_id: groupId,
      username: savedMsg.user,
      text: savedMsg.text,
      time: savedMsg.time
    });

    io.to(groupId).emit("new-message", savedMsg);
  });

  socket.on("play-video", async ({ groupId, videoId }) => {
    await supabase
      .from("groups")
      .update({
        current_video: videoId,
        last_activity: new Date().toISOString()
      })
      .eq("id", groupId);

    socket.to(groupId).emit("sync-video", { videoId });
  });

  socket.on("private-message", data => {
    if (!data || !data.to || !data.from) return;

    if (onlineUsers[data.to]) {
      io.to(onlineUsers[data.to]).emit("private-message", data);
    }
  });

  socket.on("profile-pic-updated", data => {
    socket.broadcast.emit("profile-pic-updated", data);
  });

  socket.on("friend-accepted", ({ from, to }) => {
    if (onlineUsers[from]) {
      io.to(onlineUsers[from]).emit("friend-request-accepted", { by: to });
    }
  });

  socket.on("leave-group", async ({ groupId, userId }) => {
    await supabase
      .from("group_members")
      .delete()
      .eq("group_id", groupId)
      .eq("username", userId);

    socket.leave(groupId);
    socket.currentGroup = null;
    socket.emit("left-group", { groupId });

    const members = await getGroupMembers(groupId);

    if (members.length === 0) {
      await deleteGroup(groupId);
      return;
    }

    io.to(groupId).emit("online-users", members);
  });

  socket.on("close-group", async ({ groupId, userId }) => {
    const { data: group } = await supabase
      .from("groups")
      .select("*")
      .eq("id", groupId)
      .maybeSingle();

    if (!group) {
      socket.emit("group-error", { message: "Group already closed" });
      return;
    }

    if (group.admin !== userId) {
      socket.emit("group-error", { message: "Only admin can close group" });
      return;
    }

    await deleteGroup(groupId);
  });

  socket.on("disconnect", () => {
    if (socket.username && onlineUsers[socket.username] === socket.id) {
      delete onlineUsers[socket.username];
    }
    console.log("Socket disconnected:", socket.id);
  });
});

// ================= CLEANUP =================

setInterval(async () => {
  const cutoff = new Date(Date.now() - GROUP_TIMEOUT_MINUTES * 60 * 1000).toISOString();

  const { data: oldGroups } = await supabase
    .from("groups")
    .select("id")
    .lt("last_activity", cutoff);

  for (const g of oldGroups || []) {
    await deleteGroup(g.id);
    console.log("Deleted inactive group:", g.id);
  }
}, 60 * 1000);

// ================= START =================

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
