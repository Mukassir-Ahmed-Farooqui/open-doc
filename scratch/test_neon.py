from src.db.base import Base
from src.db.database import engine

import src.db.models

Base.metadata.create_all(bind=engine)

print("Neon connection successful!")
