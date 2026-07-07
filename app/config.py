from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    database_url: str = "postgresql+asyncpg://portfolio:portfolio@db:5432/portfolio"
    kite_redirect_url: str = "http://localhost:8000/api/v1/kite/auth/callback"
    kite_api_key: str | None = None
    kite_api_secret: str | None = None
    frontend_url: str = "http://localhost:5173"
    demo_mode: bool = False


settings = Settings()
