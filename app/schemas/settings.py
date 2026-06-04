from pydantic import BaseModel


class DeleteResult(BaseModel):
    deleted: int
    message: str


class DbInfo(BaseModel):
    host: str
    port: int
    name: str
