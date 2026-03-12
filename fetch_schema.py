"""Utility script to fetch BigQuery table schemas and save to JSON.

Usage:
    python fetch_schema.py
    python fetch_schema.py --project my-project --dataset my_dataset --output schemas.json
"""

import argparse
import json
import logging
import os

from google.cloud import bigquery
from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)


def fetch_schemas(project: str, dataset: str) -> dict:
    client = bigquery.Client(project=project)
    tables = client.list_tables(f"{project}.{dataset}")

    schemas = {}
    for table_ref in tables:
        table = client.get_table(f"{project}.{dataset}.{table_ref.table_id}")
        schemas[table_ref.table_id] = [field.name for field in table.schema]
        logger.info("Fetched schema for %s (%d columns)", table_ref.table_id, len(table.schema))

    return schemas


def main():
    parser = argparse.ArgumentParser(description="Fetch BigQuery table schemas")
    parser.add_argument("--project", default=os.getenv("BIGQUERY_PROJECT", ""))
    parser.add_argument("--dataset", default=os.getenv("BIGQUERY_DATASET", ""))
    parser.add_argument("--output", default="table_schemas.json")
    args = parser.parse_args()

    if not args.project or not args.dataset:
        logger.error("Project and dataset are required. Set BIGQUERY_PROJECT/BIGQUERY_DATASET or use --project/--dataset")
        return

    logger.info("Fetching schemas from %s.%s", args.project, args.dataset)
    schemas = fetch_schemas(args.project, args.dataset)

    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(schemas, f, indent=4)

    logger.info("Saved %d table schemas to %s", len(schemas), args.output)


if __name__ == "__main__":
    main()
