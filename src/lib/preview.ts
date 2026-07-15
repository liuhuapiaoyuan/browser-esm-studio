import type { FileMap } from "../types";

type WorkerReply = { ok: true } | { ok: false; error?: string };

let registrationPromise: Promise<ServiceWorkerRegistration> | null = null;

function postToWorker(worker: ServiceWorker, message: object, timeout = 5000): Promise<WorkerReply> {
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const timer = window.setTimeout(() => reject(new Error("Service Worker 响应超时。")), timeout);

    channel.port1.onmessage = (event: MessageEvent<WorkerReply>) => {
      window.clearTimeout(timer);
      if (event.data?.ok) resolve(event.data);
      else reject(new Error((event.data as { error?: string })?.error || "Service Worker 处理失败。"));
    };

    worker.postMessage(message, [channel.port2]);
  });
}

function waitForWorkerActivation(worker: ServiceWorker | null): Promise<ServiceWorker | void> {
  if (!worker) return Promise.resolve();
  if (worker.state === "activated") return Promise.resolve(worker);

  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error("Service Worker 激活超时。")), 8000);
    worker.addEventListener("statechange", () => {
      if (worker.state === "activated") {
        window.clearTimeout(timer);
        resolve(worker);
      }
      if (worker.state === "redundant") {
        window.clearTimeout(timer);
        reject(new Error("Service Worker 激活失败。"));
      }
    });
  });
}

async function ensureActiveWorker(registration: ServiceWorkerRegistration): Promise<ServiceWorker | null> {
  const pending = registration.installing || registration.waiting;
  if (pending) await waitForWorkerActivation(pending);
  await navigator.serviceWorker.ready;
  return registration.active;
}

async function claimClients(worker: ServiceWorker | null): Promise<void> {
  if (!worker) return;
  try {
    await postToWorker(worker, { type: "CLAIM_CLIENTS" }, 3000);
  } catch {
    // Older SW builds may not handle CLAIM_CLIENTS; controllerchange/poll still apply.
  }
}

function waitForController(timeout = 8000): Promise<void> {
  if (navigator.serviceWorker.controller) return Promise.resolve();

  return new Promise((resolve, reject) => {
    let settled = false;

    function finish(error?: Error) {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      window.clearInterval(poll);
      navigator.serviceWorker.removeEventListener("controllerchange", onChange);
      if (error) reject(error);
      else resolve();
    }

    function onChange() {
      if (navigator.serviceWorker.controller) finish();
    }

    const timer = window.setTimeout(() => {
      if (navigator.serviceWorker.controller) finish();
      else finish(new Error("Preview Service Worker 未接管当前页面，请刷新后重试。"));
    }, timeout);

    const poll = window.setInterval(onChange, 50);
    navigator.serviceWorker.addEventListener("controllerchange", onChange);
  });
}

export async function ensurePreviewRuntime(): Promise<ServiceWorkerRegistration> {
  if (!("serviceWorker" in navigator)) {
    throw new Error("当前浏览器不支持 Service Worker。请使用最新版 Chrome、Edge 或 Firefox。");
  }

  if (!window.isSecureContext) {
    throw new Error("Preview 需要 HTTPS 或 localhost 安全上下文。");
  }

  if (!registrationPromise) {
    registrationPromise = navigator.serviceWorker
      .register("/preview-sw.js?v=4", { scope: "/" })
      .then(async (registration) => {
        try {
          await registration.update();
        } catch {
          // Ignore update failures; the existing registration may still work.
        }

        const worker = await ensureActiveWorker(registration);
        if (!navigator.serviceWorker.controller) {
          await claimClients(worker);
        }
        await waitForController();
        return registration;
      })
      .catch((error: unknown) => {
        registrationPromise = null;
        throw error;
      });
  }

  return registrationPromise;
}

export async function syncPreviewProject(sessionId: string, files: FileMap): Promise<WorkerReply> {
  const registration = await ensurePreviewRuntime();
  const worker = navigator.serviceWorker.controller || registration.active;

  if (!worker) throw new Error("Preview Service Worker 尚未启动。");

  return postToWorker(worker, { type: "SYNC_PREVIEW_PROJECT", sessionId, files }, 8000);
}

export function previewUrl(sessionId: string, revision: number): string {
  return `/__preview__/${encodeURIComponent(sessionId)}/index.html?revision=${revision}`;
}
