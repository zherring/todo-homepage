// Background script (background.js)
const channel = new BroadcastChannel("todo_updates");
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local") {
    channel.postMessage("update");
  }
});