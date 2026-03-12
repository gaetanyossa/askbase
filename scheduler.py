"""Scheduled reports -- run queries on a cron and send results via Telegram or email."""

import logging
from datetime import datetime

import httpx
from apscheduler.schedulers.background import BackgroundScheduler

logger = logging.getLogger(__name__)

_scheduler = BackgroundScheduler()
_jobs: dict[str, dict] = {}  # job_id -> config


def start():
    if not _scheduler.running:
        _scheduler.start()
        logger.info("Scheduler started.")


def stop():
    if _scheduler.running:
        _scheduler.shutdown(wait=False)


def get_jobs() -> list[dict]:
    return [
        {
            "id": jid,
            "question": cfg["question"],
            "cron": cfg["cron"],
            "channel": cfg["channel"],
            "last_run": cfg.get("last_run"),
            "last_status": cfg.get("last_status"),
        }
        for jid, cfg in _jobs.items()
    ]


def add_job(
    job_id: str,
    question: str,
    cron: str,
    channel: str,
    channel_config: dict,
    ask_fn,
    ask_kwargs: dict,
):
    """Add a scheduled report.

    cron: "HH:MM" for daily, or "*/5" for every 5 minutes (simplified).
    channel: "telegram"
    channel_config: {"bot_token": "...", "chat_id": "..."}
    """
    _jobs[job_id] = {
        "question": question,
        "cron": cron,
        "channel": channel,
        "channel_config": channel_config,
        "ask_fn": ask_fn,
        "ask_kwargs": ask_kwargs,
        "last_run": None,
        "last_status": None,
    }

    # Parse cron
    hour, minute = 9, 0
    if ":" in cron:
        parts = cron.split(":")
        hour, minute = int(parts[0]), int(parts[1])

    _scheduler.add_job(
        _run_job,
        "cron",
        hour=hour,
        minute=minute,
        args=[job_id],
        id=job_id,
        replace_existing=True,
    )
    logger.info(f"Scheduled job '{job_id}' at {hour:02d}:{minute:02d}")


def remove_job(job_id: str):
    if job_id in _jobs:
        del _jobs[job_id]
    try:
        _scheduler.remove_job(job_id)
    except Exception:
        pass


def _run_job(job_id: str):
    cfg = _jobs.get(job_id)
    if not cfg:
        return

    cfg["last_run"] = datetime.now().isoformat()

    try:
        result = cfg["ask_fn"](**cfg["ask_kwargs"], question=cfg["question"])
        answer = result.get("answer", "No result.")

        if cfg["channel"] == "telegram":
            _send_telegram(cfg["channel_config"], cfg["question"], answer)

        cfg["last_status"] = "ok"
        logger.info(f"Job '{job_id}' completed successfully.")

    except Exception as e:
        cfg["last_status"] = f"error: {e}"
        logger.error(f"Job '{job_id}' failed: {e}")


def _send_telegram(config: dict, question: str, answer: str):
    bot_token = config.get("bot_token", "")
    chat_id = config.get("chat_id", "")
    if not bot_token or not chat_id:
        raise ValueError("Telegram bot_token and chat_id are required")

    text = f"📊 *AskBase Report*\n\n*Question:* {question}\n\n{answer}"

    with httpx.Client() as client:
        resp = client.post(
            f"https://api.telegram.org/bot{bot_token}/sendMessage",
            json={
                "chat_id": chat_id,
                "text": text,
                "parse_mode": "Markdown",
            },
        )
        if resp.status_code != 200:
            raise RuntimeError(f"Telegram API error: {resp.text}")
