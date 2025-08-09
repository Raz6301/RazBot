// invites.js
const fs = require("fs");
const path = require("path");

const invitesFile = path.join(__dirname, "invites.json");
const config = require('./config.json');

function saveInvites(data) {
  fs.writeFileSync(invitesFile, JSON.stringify(data, null, 2));
}

function loadInvites() {
  if (!fs.existsSync(invitesFile)) return {};
  return JSON.parse(fs.readFileSync(invitesFile));
}

module.exports = function trackInvites(client, io) {
  const invitesCache = new Map();

  client.on("ready", async () => {
    for (const [guildId, guild] of client.guilds.cache) {
      const invites = await guild.invites.fetch().catch(() => []);
      invitesCache.set(guildId, new Map(invites.map(inv => [inv.code, inv.uses])));
    }
  });

  client.on("guildMemberAdd", async member => {
    const cachedInvites = invitesCache.get(member.guild.id);
    const newInvites = await member.guild.invites.fetch().catch(() => []);

    const usedInvite = newInvites.find(inv => {
      const prev = cachedInvites?.get(inv.code) || 0;
      return inv.uses > prev;
    });

    // עדכון קאש להזמנות הבאות
    invitesCache.set(member.guild.id, new Map(newInvites.map(inv => [inv.code, inv.uses])));

    const data = loadInvites();
    const inviterId = usedInvite?.inviter?.id;
    if (!inviterId) return;

    if (!data[inviterId]) {
      data[inviterId] = {
        count: 0,
        invited: [],
        dates: {}
      };
    }

    data[inviterId].count++;
    data[inviterId].invited.push(member.id);

    const today = new Date().toISOString().split("T")[0];
    if (!data[inviterId].dates[today]) data[inviterId].dates[today] = 0;
    data[inviterId].dates[today]++;

    saveInvites(data);
    // If an invite log channel is configured, send a message about the join/ inviter details
    try {
      const channelId = config.inviteLogChannelId;
      if (channelId) {
        const channel = member.guild.channels.cache.get(channelId);
        if (channel) {
          const inviterTag = usedInvite.inviter ? usedInvite.inviter.tag : 'Unknown';
          const inviterId = usedInvite.inviter ? usedInvite.inviter.id : null;
          const totalInvites = data[inviterId]?.count || 0;
          await channel.send(`📨 ${member.user.tag} הצטרף לשרת. המוזמן: ${inviterTag}, כמות ההזמנות הכוללת: ${totalInvites}`);
        }
      }
    } catch (err) {
      console.error('Failed to send invite log message:', err);
    }
    // שליחת עדכון לרשימת ההזמנות בזמן אמת דרך Socket.io
    if (io) {
      try {
        const formatted = await Promise.all(
          Object.entries(data).map(async ([userId, entry]) => {
            let username = 'Unknown';
            try {
              const user = await client.users.fetch(userId);
              if (user) username = user.tag;
            } catch {}
            return {
              userId,
              username,
              count: entry.count,
              invited: entry.invited || []
            };
          })
        );
        io.emit('invites', formatted);
      } catch {}
    }

    console.log(`📨 ${member.user.tag} הוזמן על ידי ${usedInvite.inviter.tag}`);
  });
};
