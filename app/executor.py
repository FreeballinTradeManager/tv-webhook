from datetime import datetime


def execute_trade(signal) -> dict:
    event = (signal.event or "").upper()

    if event == "ENTRY":
        return {
            "status": "executed_sim",
            "action": "would_place_order",
            "ticker": signal.ticker,
            "side": signal.side,
            "qty": signal.qty,
            "timestamp": datetime.utcnow().isoformat()
        }

    elif event == "STOP_UPDATE":
        return {
            "status": "executed_sim",
            "action": "would_update_stop",
            "ticker": signal.ticker,
            "side": signal.side,
            "qty": signal.qty,
            "timestamp": datetime.utcnow().isoformat()
        }

    elif event == "CLOSE50":
        return {
            "status": "executed_sim",
            "action": "would_close_half",
            "ticker": signal.ticker,
            "side": signal.side,
            "qty": signal.qty,
            "timestamp": datetime.utcnow().isoformat()
        }

    elif event in ["MASTER_CLOSE", "CLOSE_FALLBACK", "EMA_EXIT", "STOP_HIT"]:
        return {
            "status": "executed_sim",
            "action": "would_close_all",
            "ticker": signal.ticker,
            "side": signal.side,
            "qty": signal.qty,
            "timestamp": datetime.utcnow().isoformat()
        }

    elif event in ["TP1", "TP2", "TP3"]:
        return {
            "status": "executed_sim",
            "action": f"would_process_{event.lower()}",
            "ticker": signal.ticker,
            "side": signal.side,
            "qty": signal.qty,
            "timestamp": datetime.utcnow().isoformat()
        }

    return {
        "status": "ignored",
        "action": "no_execution_rule",
        "ticker": signal.ticker,
        "side": signal.side,
        "qty": signal.qty,
        "timestamp": datetime.utcnow().isoformat()
    }
