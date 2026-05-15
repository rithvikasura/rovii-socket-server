const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");

const app = express();

app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));

app.use(express.json({ limit: "50mb" }));

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type", "Authorization"]
  },
  transports: ["websocket", "polling"]
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const onlineUsers = {};
const GROUP_TIMEOUT_MINUTES = 30;
const MESSAGE_TTL_MINUTES = 60 * 24 * 7; // 7 days (changed from 60 minutes)

function nowTime() {
  return new Date().toLocaleTimeString();
}

function makeSessionId() {
  return Date.now().toString() + Math.random().toString(36).slice(2);
}

function makeGroupId() {
  return Math.random().toString(36).substring(2, 10);
}

function cleanName(name) {
  return String(name || "").trim();
}

app.get("/", (req, res) => {
  res.send("Rovii Backend Running with Supabase");
});

app.get("/debug/env", (req, res) => {
  res.json({
    hasUrl: !!process.env.SUPABASE_URL,
    hasKey: !!process.env.SUPABASE_KEY
  });
});

/* ================= AUTH ================= */

app.post("/api/register", async (req, res) => {
  try {
    const username = cleanName(req.body.username);
    const password = String(req.body.password || "");
    const motherName = String(req.body.motherName || "");
    const fatherName = String(req.body.fatherName || "");

    if (!username || !password) {
      return res.json({ success: false, message: "Missing username/password" });
    }

    const { data: existing, error: findError } = await supabase
      .from("users")
      .select("username")
      .ilike("username", username)
      .maybeSingle();

    if (findError) throw findError;

    if (existing) {
      return res.json({ success: false, message: "Username already exists" });
    }

    const { error } = await supabase.from("users").insert({
      username,
      password,
      mother_name: motherName,
      father_name: fatherName,
      profile_pic: ""
    });

    if (error) throw error;

    res.json({ success: true });
  } catch (err) {
    console.log("REGISTER ERROR:", err);
    res.status(500).json({ success: false, message: err.message || "Server error" });
  }
});

app.post("/api/login", async (req, res) => {
  try {
    const username = cleanName(req.body.username);
    const password = String(req.body.password || "");

    const { data: user, error } = await supabase
      .from("users")
      .select("*")
      .ilike("username", username)
      .eq("password", password)
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
    console.log("LOGIN ERROR:", err);
    res.status(500).json({ success: false, message: err.message || "Server error" });
  }
});

app.post("/api/logout", async (req, res) => {
  const sessionId = req.body.sessionId;

  if (sessionId) {
    await supabase.from("sessions").delete().eq("session_id", sessionId);
  }

  res.json({ success: true });
});

app.post("/api/verify", async (req, res) => {
  try {
    const sessionId = req.body.sessionId;

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

app.post("/api/forgot-password", async (req, res) => {
  try {
    const username = cleanName(req.body.username);
    const motherName = String(req.body.motherName || "");
    const fatherName = String(req.body.fatherName || "");
    const newPassword = String(req.body.newPassword || "");

    const { data: user, error } = await supabase
      .from("users")
      .select("*")
      .ilike("username", username)
      .ilike("mother_name", motherName)
      .ilike("father_name", fatherName)
      .maybeSingle();

    if (error) throw error;

    if (!user) {
      return res.json({ success: false, message: "Security details not matched" });
    }

    const { error: updateError } = await supabase
      .from("users")
      .update({ password: newPassword })
      .eq("username", user.username);

    if (updateError) throw updateError;

    res.json({ success: true });
  } catch (err) {
    console.log("FORGOT ERROR:", err);
    res.status(500).json({ success: false, message: err.message || "Server error" });
  }
});

/* ================= PROFILE PIC ================= */

app.post("/api/upload-pic", async (req, res) => {
  try {
    const username = cleanName(req.body.username);
    const imageData = req.body.imageData || "";

    if (!username || !imageData) {
      return res.json({ success: false, message: "Missing image/user" });
    }

    const { error } = await supabase
      .from("users")
      .update({ profile_pic: imageData })
      .ilike("username", username);

    if (error) throw error;

    res.json({ success: true });
  } catch (err) {
    console.log("UPLOAD PIC ERROR:", err);
    res.status(500).json({ success: false, message: err.message || "Upload failed" });
  }
});

app.get("/api/get-pic", async (req, res) => {
  try {
    const username = cleanName(req.query.username);

    const { data, error } = await supabase
      .from("users")
      .select("profile_pic")
      .ilike("username", username)
      .maybeSingle();

    if (error) throw error;

    res.json({ profilePic: data?.profile_pic || "" });
  } catch {
    res.json({ profilePic: "" });
  }
});

/* ================= FRIENDS ================= */

app.get("/user-exists", async (req, res) => {
  try {
    const username = cleanName(req.query.username);

    const { data, error } = await supabase
      .from("users")
      .select("username")
      .ilike("username", username)
      .maybeSingle();

    if (error) throw error;

    res.json({ exists: !!data, username: data?.username || null });
  } catch (err) {
    console.log("USER EXISTS ERROR:", err);
    res.json({ exists: false });
  }
});

app.get("/api/friends", async (req, res) => {
  try {
    const username = cleanName(req.query.username);

    const { data, error } = await supabase
      .from("friends")
      .select("*")
      .or(`user1.eq.${username},user2.eq.${username}`);

    if (error) throw error;

    const friends = (data || []).map(f => f.user1 === username ? f.user2 : f.user1);

    res.json({ friends });
  } catch (err) {
    console.log("FRIENDS ERROR:", err);
    res.json({ friends: [] });
  }
});

app.get("/api/friend-requests", async (req, res) => {
  try {
    const username = cleanName(req.query.username);

    const { data, error } = await supabase
      .from("friend_requests")
      .select("from_user")
      .eq("to_user", username)
      .eq("status", "pending");

    if (error) throw error;

    res.json({ requests: (data || []).map(r => r.from_user) });
  } catch (err) {
    console.log("REQ ERROR:", err);
    res.json({ requests: [] });
  }
});

app.post("/api/send-friend-request", async (req, res) => {
  try {
    const cleanFrom = cleanName(req.body.from);
    const cleanTo = cleanName(req.body.to);

    if (!cleanFrom || !cleanTo || cleanFrom.toLowerCase() === cleanTo.toLowerCase()) {
      return res.json({ success: false, message: "Invalid request" });
    }

    const { data: target, error: targetError } = await supabase
      .from("users")
      .select("username")
      .ilike("username", cleanTo)
      .maybeSingle();

    if (targetError) throw targetError;

    if (!target) {
      return res.json({ success: false, message: "User not registered" });
    }

    const realTo = target.username;

    const { data: alreadyFriend, error: friendError } = await supabase
      .from("friends")
      .select("*")
      .or(`and(user1.eq.${cleanFrom},user2.eq.${realTo}),and(user1.eq.${realTo},user2.eq.${cleanFrom})`)
      .maybeSingle();

    if (friendError) throw friendError;

    if (alreadyFriend) {
      return res.json({ success: false, message: "Already friends" });
    }

    const { error } = await supabase
      .from("friend_requests")
      .upsert({
        from_user: cleanFrom,
        to_user: realTo,
        status: "pending"
      }, {
        onConflict: "from_user,to_user"
      });

    if (error) throw error;

    res.json({ success: true });
  } catch (err) {
    console.log("SEND FRIEND ERROR:", err);
    res.status(500).json({ success: false, message: err.message || "Server error" });
  }
});

app.post("/api/accept-friend", async (req, res) => {
  try {
    const from = cleanName(req.body.from);
    const to = cleanName(req.body.to);

    const { error } = await supabase
      .from("friends")
      .upsert({ user1: from, user2: to }, { onConflict: "user1,user2" });

    if (error) throw error;

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
    console.log("ACCEPT ERROR:", err);
    res.status(500).json({ success: false, message: err.message || "Server error" });
  }
});

app.post("/api/reject-friend", async (req, res) => {
  const from = cleanName(req.body.from);
  const to = cleanName(req.body.to);

  await supabase
    .from("friend_requests")
    .delete()
    .eq("from_user", from)
    .eq("to_user", to);

  res.json({ success: true });
});

app.post("/api/remove-friend", async (req, res) => {
  const user1 = cleanName(req.body.user1);
  const user2 = cleanName(req.body.user2);

  await supabase
    .from("friends")
    .delete()
    .or(`and(user1.eq.${user1},user2.eq.${user2}),and(user1.eq.${user2},user2.eq.${user1})`);

  res.json({ success: true });
});

/* ================= PRIVATE MESSAGES ================= */

app.post("/api/send-private-message", async (req, res) => {
  try {
    const from = cleanName(req.body.from);
    const to = cleanName(req.body.to);
    const text = String(req.body.text || "");
    const time = req.body.time || nowTime();

    const { error } = await supabase
      .from("private_messages")
      .insert({ from_user: from, to_user: to, text, time });

    if (error) throw error;

    res.json({ success: true });
  } catch (err) {
    console.log("PRIVATE SEND ERROR:", err);
    res.status(500).json({ success: false, message: err.message || "Server error" });
  }
});

app.get("/api/private-messages", async (req, res) => {
  try {
    const user1 = cleanName(req.query.user1);
    const user2 = cleanName(req.query.user2);

    const cutoff = new Date(Date.now() - MESSAGE_TTL_MINUTES * 60 * 1000).toISOString();

    // Don't delete old messages on GET - separate cleanup
    const { data, error } = await supabase
      .from("private_messages")
      .select("*")
      .or(`and(from_user.eq.${user1},to_user.eq.${user2}),and(from_user.eq.${user2},to_user.eq.${user1})`)
      .gte("created_at", cutoff)
      .order("created_at", { ascending: true });

    if (error) throw error;

    res.json({ messages: data || [] });
  } catch (err) {
    console.log("PRIVATE GET ERROR:", err);
    res.json({ messages: [] });
  }
});

/* ================= GROUP HELPERS ================= */

async function getGroup(groupId) {
  const { data, error } = await supabase
    .from("groups")
    .select("*")
    .eq("id", groupId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

async function getGroupMembers(groupId) {
  const { data, error } = await supabase
    .from("group_members")
    .select("username")
    .eq("group_id", groupId);

  if (error) {
    console.log("GROUP MEMBERS ERROR:", error);
    return [];
  }

  return (data || []).map(x => x.username);
}

async function getGroupMessages(groupId) {
  const cutoff = new Date(Date.now() - MESSAGE_TTL_MINUTES * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from("group_messages")
    .select("*")
    .eq("group_id", groupId)
    .gte("created_at", cutoff)
    .order("created_at", { ascending: true })
    .limit(100);

  if (error) {
    console.log("GROUP MSGS ERROR:", error);
    return [];
  }

  return data || [];
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

  await supabase
    .from("groups")
    .delete()
    .eq("id", groupId);
}

/* ================= SOCKET ================= */

io.on("connection", socket => {
  console.log("Socket connected:", socket.id);

  socket.on("register-user", ({ username }) => {
    const clean = cleanName(username);
    socket.username = clean;

    if (clean) onlineUsers[clean] = socket.id;
  });

  socket.on("create-group", async ({ userId }) => {
    try {
      const cleanUser = cleanName(userId);
      const groupId = makeGroupId();

      const { error: gError } = await supabase
        .from("groups")
        .insert({
          id: groupId,
          admin: cleanUser,
          last_activity: new Date().toISOString()
        });

      if (gError) throw gError;

      const { error: mError } = await supabase
        .from("group_members")
        .insert({
          group_id: groupId,
          username: cleanUser
        });

      if (mError) throw mError;

      socket.join(groupId);
      socket.currentGroup = groupId;

      // ✅ FIXED: Send old messages
      const oldMessages = await getGroupMessages(groupId);
      const formattedMessages = oldMessages.map(m => ({
        user: m.username,
        text: m.text,
        time: m.time
      }));

      socket.emit("group-created", groupId);
      socket.emit("admin-status", true);
      socket.emit("old-messages", formattedMessages);

      io.to(groupId).emit("online-users", await getGroupMembers(groupId));
    } catch (err) {
      console.log("CREATE GROUP ERROR:", err);
      socket.emit("group-error", { message: err.message || "Create group failed" });
    }
  });

  socket.on("join-group", async ({ groupId, userId }) => {
    try {
      const cleanGroup = cleanName(groupId);
      const cleanUser = cleanName(userId);

      const group = await getGroup(cleanGroup);

      if (!group) {
        socket.emit("group-error", { message: "Group not found or expired" });
        return;
      }

      await supabase
        .from("groups")
        .update({ last_activity: new Date().toISOString() })
        .eq("id", cleanGroup);

      await supabase
        .from("group_members")
        .upsert({
          group_id: cleanGroup,
          username: cleanUser
        }, {
          onConflict: "group_id,username"
        });

      socket.join(cleanGroup);
      socket.currentGroup = cleanGroup;

      // ✅ FIXED: Send old messages to new member
      const oldMessages = await getGroupMessages(cleanGroup);
      const formattedMessages = oldMessages.map(m => ({
        user: m.username,
        text: m.text,
        time: m.time
      }));

      socket.emit("joined-group", cleanGroup);
      socket.emit("admin-status", group.admin === cleanUser);
      socket.emit("old-messages", formattedMessages);

      io.to(cleanGroup).emit("online-users", await getGroupMembers(cleanGroup));
    } catch (err) {
      console.log("JOIN GROUP ERROR:", err);
      socket.emit("group-error", { message: err.message || "Join group failed" });
    }
  });

  socket.on("rejoin-group", async ({ groupId, userId }) => {
    try {
      const cleanGroup = cleanName(groupId);
      const cleanUser = cleanName(userId);

      const group = await getGroup(cleanGroup);

      if (!group) {
        socket.emit("group-error", { message: "Group not found or expired" });
        return;
      }

      await supabase
        .from("group_members")
        .upsert({
          group_id: cleanGroup,
          username: cleanUser
        }, {
          onConflict: "group_id,username"
        });

      socket.join(cleanGroup);
      socket.currentGroup = cleanGroup;

      // ✅ FIXED: Send old messages on rejoin
      const oldMessages = await getGroupMessages(cleanGroup);
      const formattedMessages = oldMessages.map(m => ({
        user: m.username,
        text: m.text,
        time: m.time
      }));

      socket.emit("admin-status", group.admin === cleanUser);
      socket.emit("old-messages", formattedMessages);

      io.to(cleanGroup).emit("online-users", await getGroupMembers(cleanGroup));
    } catch (err) {
      console.log("REJOIN GROUP ERROR:", err);
      socket.emit("group-error", { message: err.message || "Rejoin failed" });
    }
  });

  socket.on("send-message", async ({ groupId, msg }) => {
    try {
      const cleanGroup = cleanName(groupId);
      const group = await getGroup(cleanGroup);

      if (!group) {
        socket.emit("group-error", { message: "Group not found or expired" });
        return;
      }

      const savedMsg = {
        user: cleanName(msg.user),
        text: String(msg.text || ""),
        time: msg.time || nowTime()
      };

      await supabase
        .from("groups")
        .update({ last_activity: new Date().toISOString() })
        .eq("id", cleanGroup);

      const { data: picUser } = await supabase
        .from("users")
        .select("profile_pic")
        .ilike("username", savedMsg.user)
        .maybeSingle();

      const { error } = await supabase
        .from("group_messages")
        .insert({
          group_id: cleanGroup,
          username: savedMsg.user,
          text: savedMsg.text,
          time: savedMsg.time,
          profile_pic: picUser?.profile_pic || ""
        });

      if (error) throw error;

      io.to(cleanGroup).emit("new-message", savedMsg);
    } catch (err) {
      console.log("SEND GROUP MSG ERROR:", err);
      socket.emit("group-error", { message: err.message || "Message failed" });
    }
  });

  socket.on("play-video", async ({ groupId, videoId }) => {
    const cleanGroup = cleanName(groupId);

    await supabase
      .from("groups")
      .update({
        current_video: videoId,
        last_activity: new Date().toISOString()
      })
      .eq("id", cleanGroup);

    socket.to(cleanGroup).emit("sync-video", { videoId });
  });

  socket.on("leave-group", async ({ groupId, userId }) => {
    const cleanGroup = cleanName(groupId);
    const cleanUser = cleanName(userId);

    await supabase
      .from("group_members")
      .delete()
      .eq("group_id", cleanGroup)
      .eq("username", cleanUser);

    socket.leave(cleanGroup);
    socket.currentGroup = null;
    socket.emit("left-group", { groupId: cleanGroup });

    const members = await getGroupMembers(cleanGroup);

    if (members.length === 0) {
      await deleteGroup(cleanGroup);
      return;
    }

    io.to(cleanGroup).emit("online-users", members);
  });

  socket.on("close-group", async ({ groupId, userId }) => {
    try {
      const cleanGroup = cleanName(groupId);
      const cleanUser = cleanName(userId);

      const group = await getGroup(cleanGroup);

      if (!group) {
        socket.emit("group-error", { message: "Group already closed" });
        return;
      }

      if (group.admin !== cleanUser) {
        socket.emit("group-error", { message: "Only admin can close group" });
        return;
      }

      await deleteGroup(cleanGroup);
    } catch (err) {
      console.log("CLOSE GROUP ERROR:", err);
      socket.emit("group-error", { message: err.message || "Close group failed" });
    }
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

  socket.on("disconnect", () => {
    if (socket.username && onlineUsers[socket.username] === socket.id) {
      delete onlineUsers[socket.username];
    }
  });
});

/* ================= CLEANUP ================= */

setInterval(async () => {
  try {
    const groupCutoff = new Date(Date.now() - GROUP_TIMEOUT_MINUTES * 60 * 1000).toISOString();
    const msgCutoff = new Date(Date.now() - MESSAGE_TTL_MINUTES * 60 * 1000).toISOString();

    // Clean old messages
    await supabase.from("group_messages").delete().lt("created_at", msgCutoff);
    await supabase.from("private_messages").delete().lt("created_at", msgCutoff);

    const { data: oldGroups } = await supabase
      .from("groups")
      .select("id")
      .lt("last_activity", groupCutoff);

    for (const g of oldGroups || []) {
      await deleteGroup(g.id);
    }
  } catch (err) {
    console.log("CLEANUP ERROR:", err);
  }
}, 60 * 1000);

/* ================= START ================= */

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
