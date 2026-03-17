from fastapi import FastAPI

app = FastAPI()

@app.get("/")
def root():
    return {"status": "running"}

@app.post("/api/webhook/trade-engine")
def webhook(data: dict):
    print("Received:", data)
    return {"message": "webhook working", "data": data}
