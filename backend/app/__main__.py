import uvicorn

from app.config import Settings

if __name__ == "__main__":
    settings = Settings()
    # Access logs include URLs; do not log user-supplied query parameters.
    uvicorn.run("app.main:app", host=settings.host, port=settings.port, access_log=False)
