(() => {
  const $ = (selector) => document.querySelector(selector);
  const view = {
    notice: $("#notice"),
    signedOut: $("#signed-out"),
    notAdmin: $("#not-admin"),
    dashboard: $("#dashboard"),
    rows: $("#user-rows"),
    loadMore: $("#load-more"),
    offset: 0,
    csrfToken: null
  };
  const PAGE_SIZE = 50;

  async function api(path, options = {}) {
    const headers = new Headers(options.headers || {});
    headers.set("Accept", "application/json");
    if (options.body !== undefined) headers.set("Content-Type", "application/json");
    if (options.method && options.method !== "GET" && view.csrfToken) {
      headers.set("X-CSRF-Token", view.csrfToken);
    }
    const response = await fetch(path, {
      ...options,
      headers,
      credentials: "same-origin",
      cache: "no-store"
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(payload?.error?.message || `Request failed (${response.status}).`);
    }
    return payload;
  }

  function textCell(row, value, className) {
    const cell = document.createElement("td");
    if (className) cell.className = className;
    cell.textContent = value;
    row.append(cell);
    return cell;
  }

  function formatTime(value) {
    return new Date(Number(value) * 1000).toLocaleString();
  }

  function appendUsers(users, reset) {
    if (reset) {
      view.rows.replaceChildren();
      view.offset = 0;
    }
    for (const user of users) {
      const row = document.createElement("tr");
      const account = document.createElement("td");
      const name = document.createElement("strong");
      name.textContent = user.displayName || user.email;
      const email = document.createElement("small");
      email.textContent = user.email;
      account.append(name, email);
      row.append(account);
      textCell(row, user.role);
      textCell(row, user.status, user.status === "active" ? "status-active" : "status-suspended");
      textCell(row, formatTime(user.createdAt));
      const actionCell = document.createElement("td");
      if (user.role === "student") {
        const button = document.createElement("button");
        button.className = user.status === "active" ? "button danger" : "button secondary";
        button.type = "button";
        button.dataset.action = "user-status";
        button.dataset.userId = user.id;
        button.dataset.status = user.status === "active" ? "suspended" : "active";
        button.textContent = user.status === "active" ? "Suspend" : "Reactivate";
        actionCell.append(button);
      } else {
        actionCell.textContent = "Managed by allowlist";
        actionCell.className = "muted";
      }
      row.append(actionCell);
      view.rows.append(row);
    }
    if (!users.length && reset) {
      const row = document.createElement("tr");
      textCell(row, "No accounts found.", "muted");
      row.firstElementChild.colSpan = 5;
      view.rows.append(row);
    }
    view.offset += users.length;
    view.loadMore.hidden = users.length < PAGE_SIZE;
  }

  async function loadUsers(reset = false) {
    const offset = reset ? 0 : view.offset;
    const result = await api(`api/admin/users?limit=${PAGE_SIZE}&offset=${offset}`);
    appendUsers(result.users, reset);
  }

  async function loadDashboard(user) {
    view.dashboard.hidden = false;
    $("#identity-name").textContent = user.displayName || "Administrator";
    $("#identity-email").textContent = user.email;
    const [overview] = await Promise.all([
      api("api/admin/overview"),
      loadUsers(true)
    ]);
    $("#active-count").textContent = overview.users.active ?? 0;
    $("#suspended-count").textContent = overview.users.suspended ?? 0;
    $("#progress-count").textContent = overview.studyProgressRecords ?? 0;
    $("#saved-count").textContent = overview.savedItems ?? 0;
    const auditList = $("#audit-list");
    auditList.replaceChildren();
    if (!overview.recentAdminEvents.length) {
      const item = document.createElement("li");
      item.className = "muted";
      item.textContent = "No administrative changes yet.";
      auditList.append(item);
    } else {
      for (const event of overview.recentAdminEvents) {
        const item = document.createElement("li");
        const action = document.createElement("strong");
        action.textContent = event.action.replaceAll("_", " ");
        const timestamp = document.createElement("time");
        timestamp.textContent = formatTime(event.createdAt);
        item.append(action, timestamp);
        auditList.append(item);
      }
    }
  }

  async function initialize() {
    const authResult = new URLSearchParams(window.location.search).get("auth");
    if (authResult === "error") {
      view.notice.textContent = "Google sign-in could not be completed. Please try again.";
    }
    try {
      const [health, auth] = await Promise.all([
        fetch("api/status", { credentials: "same-origin", cache: "no-store" }),
        api("api/auth/me")
      ]);
      const healthBody = await health.json().catch(() => null);
      if (!health.ok || healthBody?.status !== "available") {
        view.notice.textContent = "The account API is unavailable. This page requires its Cloudflare Pages deployment.";
        return;
      }
      if (!auth.authenticated) {
        view.notice.textContent = "Sign in with Google to continue.";
        view.signedOut.hidden = false;
        return;
      }
      view.csrfToken = auth.csrfToken;
      if (auth.user.role !== "admin") {
        view.notice.textContent = `Signed in as ${auth.user.email}. Administrator access is not assigned to this account.`;
        view.notAdmin.hidden = false;
        return;
      }
      view.notice.textContent = "Signed in. Administrator actions are audited.";
      await loadDashboard(auth.user);
    } catch (error) {
      view.notice.textContent = error.message.includes("Failed to fetch")
        ? "The account API is unavailable. This page requires its Cloudflare Pages deployment."
        : error.message;
    }
  }

  document.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    try {
      if (button.dataset.action === "logout") {
        await api("api/auth/logout", { method: "POST" });
        window.location.reload();
      } else if (button.dataset.action === "user-status") {
        const nextStatus = button.dataset.status;
        const userId = button.dataset.userId;
        if (!window.confirm(`${nextStatus === "suspended" ? "Suspend" : "Reactivate"} this student account?`)) return;
        button.disabled = true;
        await api(`api/admin/users/${encodeURIComponent(userId)}/status`, {
          method: "PATCH",
          body: JSON.stringify({ status: nextStatus })
        });
        view.notice.textContent = `Account ${nextStatus}. The action was recorded in the audit log.`;
        await loadDashboard({ displayName: $("#identity-name").textContent, email: $("#identity-email").textContent });
      }
    } catch (error) {
      view.notice.textContent = error.message;
      button.disabled = false;
    }
  });

  $("#refresh").addEventListener("click", () => {
    loadDashboard({ displayName: $("#identity-name").textContent, email: $("#identity-email").textContent })
      .catch((error) => { view.notice.textContent = error.message; });
  });
  view.loadMore.addEventListener("click", () => {
    loadUsers(false).catch((error) => { view.notice.textContent = error.message; });
  });
  initialize();
})();
