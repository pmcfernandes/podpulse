from pathlib import Path
import logging
from sqlmodel import SQLModel, create_engine, text

LOG = logging.getLogger(__name__)


def get_db_path(base: Path | None = None) -> Path:
    base = base or Path(__file__).resolve().parents[1]
    return base / "podpulse.db"


def init_engine(sqlite_path: Path | str | None = None):
    sqlite_path = sqlite_path or get_db_path()
    db_url = f"sqlite:///{sqlite_path}"
    engine = create_engine(db_url, connect_args={"check_same_thread": False})
    return engine


def apply_migration_if_needed(engine, migration_file: Path):
    """Apply the given migration script only if it hasn't been applied before.

    Uses a simple `migrations_applied` table to track applied filenames.
    """
    with engine.connect() as conn:
        conn.execute(text("PRAGMA foreign_keys = ON;"))
        conn.commit()
        # ensure migrations table
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS migrations_applied (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                filename TEXT NOT NULL UNIQUE,
                applied_at INTEGER DEFAULT (strftime('%s','now'))
            );
        """))
        conn.commit()

        fname = migration_file.name
        res = conn.execute(text("SELECT 1 FROM migrations_applied WHERE filename = :fn"), {"fn": fname}).fetchone()
        if res:
            LOG.debug("Migration %s already applied", fname)
            return False

        sql = migration_file.read_text(encoding="utf-8")
        # sqlite3's DB-API supports executing multiple statements at once via
        # `executescript`. SQLAlchemy's `exec_driver_sql`/execute doesn't allow
        # multiple statements in a single execute for the sqlite DBAPI driver
        # and will raise "You can only execute one statement at a time.".
        # Use a raw DB-API connection for sqlite files and fall back to
        # exec_driver_sql for other backends.
        if engine.dialect.name == "sqlite":
            raw_conn = engine.raw_connection()
            try:
                # raw_conn is a DB-API connection (sqlite3.Connection); use
                # executescript to run the whole migration file.
                raw_conn.executescript(sql)
                raw_conn.commit()
            finally:
                raw_conn.close()
        else:
            conn.exec_driver_sql(sql)

        # record the applied migration using SQLAlchemy connection
        conn.execute(text("INSERT INTO migrations_applied (filename) VALUES (:fn)"), {"fn": fname})
        conn.commit()
        LOG.info("Applied migration %s", fname)
        return True


def init_db_and_engine(base_path: Path | None = None):
    base = Path(__file__).resolve().parents[1] if base_path is None else Path(base_path)
    migration_file = base / "migrations" / "001_initial.sql"
    engine = init_engine(base / "podpulse.db")
    # create SQLModel metadata tables if they don't exist
    SQLModel.metadata.create_all(engine)
    # apply migration idempotently
    if migration_file.exists():
        apply_migration_if_needed(engine, migration_file)
    return engine
