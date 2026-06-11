from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy import String
from app.database.base import Base

class Role(Base):
    """SQLAlchemy model for OREON operational personas."""
    __tablename__ = "roles"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(50), unique=True, index=True)
    description: Mapped[str] = mapped_column(String(255))
