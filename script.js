
const SUPABASE_URL = "https://sknjnklfbotzsphhkdzf.supabase.co";
const SUPABASE_KEY = "sb_publishable_SKmM4clfhu5qrYdcGx0UTQ_VIXWmMzK";

const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// HTML elements
const authScreen = document.getElementById("auth-screen");
const chatScreen = document.getElementById("chat-screen");
const authForm = document.getElementById("auth-form");
const authMessage = document.getElementById("auth-message");
const displayNameInput = document.getElementById("display-name");
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const signupBtn = document.getElementById("signup-btn");
const logoutBtn = document.getElementById("logout-btn");
const who = document.getElementById("who");
const connectionStatus = document.getElementById("connection-status");
const messagesContainer = document.getElementById("messages");
const messageForm = document.getElementById("message-form");
const messageInput = document.getElementById("message-input");
const sendBtn = document.getElementById("send-btn");

let currentUser = null;
let realtimeChannel = null;
let sending = false;

// ------------------------------
// GENERAL HELPERS
// ------------------------------

function setStatus(message) {
  if (connectionStatus) {
    connectionStatus.textContent = message;
  }
}

function showAuthMessage(message, isError = true) {
  if (authMessage) {
    authMessage.textContent = message;
    authMessage.style.color = isError ? "#dc2626" : "#15803d";
  }
}

function showAuthScreen() {
  if (authScreen) authScreen.hidden = false;
  if (chatScreen) chatScreen.hidden = true;
}

function showChatScreen() {
  if (authScreen) authScreen.hidden = true;
  if (chatScreen) chatScreen.hidden = false;
}

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    };

    return entities[character];
  });
}

function formatTime(dateValue) {
  if (!dateValue) return "";

  const date = new Date(dateValue);

  if (Number.isNaN(date.getTime())) return "";

  return date.toLocaleString([], {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit"
  });
}

// ------------------------------
// PROFILE / DISPLAY NAME
// ------------------------------

async function getProfileName(userId) {
  if (!userId) return "";

  const { data, error } = await db
    .from("profiles")
    .select("display_name")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    console.error("Could not load profile:", error.message);
    return "";
  }

  return data?.display_name?.trim() || "";
}

async function saveProfile(user, preferredName = "") {
  if (!user) return "";

  // Use the saved profile name first so an existing name is not
  // accidentally replaced with an email address.
  const existingName = await getProfileName(user.id);

  const name =
    existingName ||
    preferredName?.trim() ||
    user.user_metadata?.display_name?.trim() ||
    user.email?.split("@")[0] ||
    "Student";

  const { error } = await db
    .from("profiles")
    .upsert(
      {
        id: user.id,
        display_name: name
      },
      { onConflict: "id" }
    );

  if (error) {
    console.error("Profile save error:", error.message);
    setStatus("Profile issue: " + error.message);
  }

  if (who) {
    who.textContent = name;
  }

  return name;
}

// ------------------------------
// DISPLAY MESSAGES
// ------------------------------

function renderMessage(message) {
  if (!messagesContainer || !message) return;

  // Do not display the same database message twice.
  if (
    message.id &&
    messagesContainer.querySelector(
      `[data-message-id="${CSS.escape(String(message.id))}"]`
    )
  ) {
    return;
  }

  const article = document.createElement("article");
  article.className = "message";

  if (message.id) {
    article.dataset.messageId = String(message.id);
  }

  const isMine =
    Boolean(currentUser) && message.user_id === currentUser.id;

  article.classList.add(isMine ? "my-message" : "other-message");

  // Prefer the sender's saved display name.
  // Never show an email for other classmates as the normal fallback.
  const senderName =
    message.profiles?.display_name?.trim() ||
    message.display_name?.trim() ||
    (isMine
      ? currentUser?.user_metadata?.display_name?.trim()
      : "") ||
    (isMine ? "You" : "Classmate");

  const header = document.createElement("div");
  header.className = "message-header";

  const name = document.createElement("strong");
  name.textContent = senderName;

  const time = document.createElement("small");
  time.textContent = formatTime(message.created_at);

  const body = document.createElement("div");
  body.className = "message-content";
  body.textContent = message.content || "";
  body.style.whiteSpace = "pre-line";

  header.append(name, time);
  article.append(header, body);

  messagesContainer.appendChild(article);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function renderLocalMessage(sender, content) {
  if (!messagesContainer) return;

  const article = document.createElement("article");
  article.className = "message other-message";

  const header = document.createElement("div");
  header.className = "message-header";

  const name = document.createElement("strong");
  name.textContent = sender;

  const time = document.createElement("small");
  time.textContent = new Date().toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit"
  });

  const body = document.createElement("div");
  body.className = "message-content";
  body.textContent = content;
  body.style.whiteSpace = "pre-line";

  header.append(name, time);
  article.append(header, body);

  messagesContainer.appendChild(article);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// ------------------------------
// LOAD CHAT HISTORY
// ------------------------------

async function loadMessages() {
  if (!messagesContainer) return;

  messagesContainer.innerHTML = "";

  const { data: messages, error } = await db
    .from("messages")
    .select("id, user_id, content, created_at")
    .order("created_at", { ascending: true })
    .limit(100);

  if (error) {
    console.error("Load messages error:", error.message);
    setStatus("Cannot load messages: " + error.message);
    return;
  }

  const userIds = [
    ...new Set(
      (messages || [])
        .map((message) => message.user_id)
        .filter(Boolean)
    )
  ];

  const nameMap = {};

  // Retrieve display names for the senders.
  if (userIds.length > 0) {
    const { data: profiles, error: profilesError } = await db
      .from("profiles")
      .select("id, display_name")
      .in("id", userIds);

    if (profilesError) {
      console.error("Load sender names error:", profilesError.message);
    } else {
      (profiles || []).forEach((profile) => {
        nameMap[profile.id] = profile.display_name?.trim() || "";
      });
    }
  }

  (messages || []).forEach((message) => {
    renderMessage({
      ...message,
      profiles: {
        display_name: nameMap[message.user_id] || ""
      }
    });
  });
}

// ------------------------------
// REALTIME CHAT
// ------------------------------

function subscribeToMessages() {
  if (realtimeChannel) {
    db.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }

  realtimeChannel = db
    .channel("class-chat-live-messages")
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "messages"
      },
      async (payload) => {
        const message = payload.new;

        const displayName = await getProfileName(message.user_id);

        renderMessage({
          ...message,
          profiles: {
            display_name: displayName
          }
        });
      }
    )
    .subscribe((status) => {
      console.log("Realtime status:", status);
    });
}

// ------------------------------
// SEND CHAT MESSAGE
// ------------------------------

async function sendMessage(text) {
  if (!currentUser) {
    throw new Error("Please sign in first.");
  }

  const cleanText = text.trim();

  if (!cleanText) return;

  const { data, error } = await db
    .from("messages")
    .insert({
      user_id: currentUser.id,
      content: cleanText
    })
    .select("id, user_id, content, created_at")
    .single();

  if (error) {
    console.error("Send message error:", error);
    throw new Error(error.message);
  }

  // Display only after Supabase confirms the save.
  const displayName =
    (await getProfileName(currentUser.id)) ||
    currentUser.user_metadata?.display_name ||
    "You";

  renderMessage({
    ...data,
    profiles: {
      display_name: displayName
    }
  });
}

// ------------------------------
// WEATHERBOT COMMANDS
// ------------------------------

async function handleCommand(text) {
  const command = text.trim();

  if (command.toLowerCase() === "/help") {
    renderLocalMessage(
      "WeatherBot",
      "Available command:\n/weather City Name\nExample: /weather Manila"
    );

    return true;
  }

  if (command.toLowerCase().startsWith("/weather")) {
    const city = command.substring("/weather".length).trim();

    if (!city) {
      renderLocalMessage(
        "WeatherBot",
        "Please enter a city name.\nExample: /weather Manila"
      );

      return true;
    }

    renderLocalMessage("WeatherBot", `Checking weather for ${city}...`);

    try {
      const geoResponse = await fetch(
        "https://geocoding-api.open-meteo.com/v1/search?name=" +
          encodeURIComponent(city) +
          "&count=1&language=en&format=json"
      );

      if (!geoResponse.ok) {
        throw new Error("Could not contact the weather service.");
      }

      const geoData = await geoResponse.json();
      const place = geoData.results?.[0];

      if (!place) {
        renderLocalMessage(
          "WeatherBot",
          `I couldn't find "${city}". Please check the city name.`
        );

        return true;
      }

      const weatherURL =
        "https://api.open-meteo.com/v1/forecast?" +
        `latitude=${place.latitude}` +
        `&longitude=${place.longitude}` +
        "&current=temperature_2m,relative_humidity_2m," +
        "apparent_temperature,precipitation,weather_code,wind_speed_10m" +
        "&timezone=auto";

      const weatherResponse = await fetch(weatherURL);

      if (!weatherResponse.ok) {
        throw new Error("Could not retrieve weather information.");
      }

      const weatherData = await weatherResponse.json();
      const weather = weatherData.current;

      const descriptions = {
        0: "Clear sky",
        1: "Mainly clear",
        2: "Partly cloudy",
        3: "Overcast",
        45: "Fog",
        48: "Depositing rime fog",
        51: "Light drizzle",
        53: "Moderate drizzle",
        55: "Dense drizzle",
        61: "Slight rain",
        63: "Moderate rain",
        65: "Heavy rain",
        71: "Slight snow",
        73: "Moderate snow",
        75: "Heavy snow",
        80: "Rain showers",
        81: "Moderate rain showers",
        82: "Heavy rain showers",
        95: "Thunderstorm",
        96: "Thunderstorm with hail",
        99: "Thunderstorm with heavy hail"
      };

      const description =
        descriptions[weather.weather_code] || "Weather information available";

      const result =
        `Weather in ${place.name}${place.country ? ", " + place.country : ""}\n` +
        `${description}\n` +
        `Temperature: ${weather.temperature_2m}°C\n` +
        `Feels like: ${weather.apparent_temperature}°C\n` +
        `Humidity: ${weather.relative_humidity_2m}%\n` +
        `Wind: ${weather.wind_speed_10m} km/h\n` +
        `Precipitation: ${weather.precipitation} mm`;

      renderLocalMessage("WeatherBot", result);
    } catch (error) {
      console.error("Weather error:", error);

      renderLocalMessage(
        "WeatherBot",
        "Weather lookup failed. Please try again later."
      );
    }

    return true;
  }

  return false;
}

// ------------------------------
// SIGN IN / SIGN UP
// ------------------------------

if (authForm) {
  authForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const email = emailInput?.value.trim();
    const password = passwordInput?.value;
    const displayName = displayNameInput?.value.trim();

    if (!email || !password) {
      showAuthMessage("Please enter your email and password.");
      return;
    }

    const isSignup = signupBtn?.dataset.mode === "signup";

    showAuthMessage(
      isSignup ? "Creating account..." : "Signing in...",
      false
    );

    try {
      if (isSignup) {
        const { data, error } = await db.auth.signUp({
          email,
          password,
          options: {
            data: {
              display_name: displayName || email.split("@")[0]
            }
          }
        });

        if (error) throw error;

        if (data.session && data.user) {
          await startChat(data.user, displayName);
          showAuthMessage("", false);
        } else {
          showAuthMessage(
            "Account created. Check your email to confirm your account, then sign in.",
            false
          );
        }
      } else {
        const { data, error } = await db.auth.signInWithPassword({
          email,
          password
        });

        if (error) throw error;

        await startChat(data.user, displayName);
        showAuthMessage("", false);
      }
    } catch (error) {
      console.error("Authentication error:", error);
      showAuthMessage(error.message || "Authentication failed.");
    }
  });
}

// If your HTML has a button for switching signup mode.
if (signupBtn) {
  signupBtn.addEventListener("click", () => {
    const isSignup = signupBtn.dataset.mode === "signup";

    if (isSignup) {
      signupBtn.dataset.mode = "signin";
      signupBtn.textContent = "Switch to Sign In";
      showAuthMessage("Sign-in mode selected.", false);
    } else {
      signupBtn.dataset.mode = "signup";
      signupBtn.textContent = "Sign Up";
      showAuthMessage("Sign-up mode selected.", false);
    }
  });
}

// ------------------------------
// START CHAT
// ------------------------------

async function startChat(user, preferredName = "") {
  currentUser = user;

  showChatScreen();
  setStatus("Loading profile...");

  await saveProfile(user, preferredName);

  setStatus("Loading messages...");
  await loadMessages();

  subscribeToMessages();

  setStatus("Connected");
}

// ------------------------------
// LOG OUT
// ------------------------------

async function stopChat() {
  currentUser = null;

  if (realtimeChannel) {
    await db.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }

  if (messagesContainer) {
    messagesContainer.innerHTML = "";
  }

  if (who) {
    who.textContent = "";
  }

  showAuthScreen();
  setStatus("Signed out");
}

if (logoutBtn) {
  logoutBtn.addEventListener("click", async () => {
    setStatus("Signing out...");

    const { error } = await db.auth.signOut();

    if (error) {
      setStatus("Logout failed: " + error.message);
      console.error("Logout error:", error);
      return;
    }

    await stopChat();
  });
}

// ------------------------------
// SEND FORM
// ------------------------------

if (messageForm) {
  messageForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (sending) return;

    const text = messageInput?.value ?? "";

    if (!text.trim()) return;

    sending = true;

    if (sendBtn) {
      sendBtn.disabled = true;
    }

    setStatus("Sending message...");

    try {
      const isCommand = await handleCommand(text);

      if (!isCommand) {
        await sendMessage(text);
      }

      // Clear input only after the message is saved or command handled.
      if (messageInput) {
        messageInput.value = "";
      }

      setStatus("Connected");
    } catch (error) {
      console.error("Send error:", error);

      setStatus("Message not sent: " + error.message);

      // Keep the typed message if sending fails.
    } finally {
      sending = false;

      if (sendBtn) {
        sendBtn.disabled = false;
      }

      messageInput?.focus();
    }
  });
}

// ------------------------------
// RESTORE LOGIN SESSION
// ------------------------------

async function restoreSession() {
  const { data, error } = await db.auth.getSession();

  if (error) {
    console.error("Session error:", error);
    showAuthScreen();
    setStatus("Please sign in");
    return;
  }

  if (data.session?.user) {
    await startChat(data.session.user);
  } else {
    showAuthScreen();
    setStatus("Please sign in");
  }
}

restoreSession();

// Keep the interface updated when the user signs out elsewhere.
db.auth.onAuthStateChange((event) => {
  if (event === "SIGNED_OUT" && currentUser) {
    stopChat();
  }
});
