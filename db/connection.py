"""Database connection URL builder for all supported database types."""


def build_connection_url(
    db_type: str,
    host: str = "",
    port: str = "",
    database: str = "",
    user: str = "",
    password: str = "",
    bigquery_project: str = "",
    bigquery_dataset: str = "",
    bigquery_credentials_path: str = "",
    sqlite_path: str = "",
) -> str:
    db_type = db_type.lower()

    if db_type == "bigquery":
        if not bigquery_project or not bigquery_dataset:
            raise ValueError("BigQuery requires project and dataset")
        url = f"bigquery://{bigquery_project}/{bigquery_dataset}"
        if bigquery_credentials_path:
            url += f"?credentials_path={bigquery_credentials_path}"
        return url

    if db_type == "mysql":
        if not host or not database:
            raise ValueError("MySQL requires host and database name")
        port = port or "3306"
        auth = f"{user}:{password}@" if user else ""
        return f"mysql+pymysql://{auth}{host}:{port}/{database}"

    if db_type == "postgresql":
        if not host or not database:
            raise ValueError("PostgreSQL requires host and database name")
        port = port or "5432"
        auth = f"{user}:{password}@" if user else ""
        return f"postgresql+psycopg2://{auth}{host}:{port}/{database}"

    if db_type == "sqlite":
        if not sqlite_path:
            raise ValueError("SQLite requires a file path")
        return f"sqlite:///{sqlite_path}"

    raise ValueError(f"Unsupported database type: {db_type}")
