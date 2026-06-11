"""Airflow DAGs for MedMKP supplier catalog ingestion.

Generates one DAG per supplier so each catalog import can be scheduled,
paused, retried, and backfilled independently. Schedules are staggered
across Sunday morning; assign a small Airflow pool via
medmkp_supplier_ingest_pool to cap how many ingests run concurrently.

Expected Airflow Variables:
- medmkp_backend_dir: absolute path to medusa-backend/apps/backend
- medmkp_env_file: optional env file to source before running npm, defaults to .env
- medmkp_supplier_ingest_pool: optional Airflow pool, defaults to default_pool
- medmkp_supplier_ingest_commit: set to "false" for dry-run tasks, defaults to true
"""

from __future__ import annotations

from datetime import datetime

from airflow import DAG
from airflow.models import Variable
from airflow.operators.bash import BashOperator

BACKEND_DIR = Variable.get("medmkp_backend_dir", default_var="/opt/medmkp/medusa-backend/apps/backend")
ENV_FILE = Variable.get("medmkp_env_file", default_var=".env")
POOL = Variable.get("medmkp_supplier_ingest_pool", default_var="default_pool")
COMMIT_ENABLED = Variable.get("medmkp_supplier_ingest_commit", default_var="true").lower() == "true"

SUPPLIERS = [
    {
        "name": "dc_dental",
        "supplier_id": "msup_dcdental_com",
        "schedule": "0 3 * * 0",
        "args": [
            "--max-links-per-source=500",
            "--max-dcdental-catalog-pages=30",
            "--source-concurrency=3",
            "--sitemap-concurrency=4",
            "--product-concurrency=6",
            "--timeout-ms=30000",
        ],
    },
    {
        "name": "amerdental",
        "supplier_id": "msup_amerdental_com",
        "schedule": "0 4 * * 0",
        "args": [
            "--max-sitemaps-per-supplier=3",
            "--sitemap-concurrency=4",
            "--product-concurrency=12",
            "--timeout-ms=30000",
        ],
    },
    {
        "name": "carolina_dental",
        "supplier_id": "msup_carolinadental_com",
        "schedule": "0 5 * * 0",
        "args": [
            "--max-sitemaps-per-supplier=10",
            "--sitemap-concurrency=4",
            "--product-concurrency=12",
            "--timeout-ms=30000",
        ],
    },
    {
        "name": "sky_dental",
        "supplier_id": "msup_skydentalsupply_com",
        "schedule": "0 6 * * 0",
        "args": [
            "--max-sitemaps-per-supplier=3",
            "--sitemap-concurrency=4",
            "--product-concurrency=12",
            "--timeout-ms=30000",
        ],
    },
    {
        "name": "shasta_dental",
        "supplier_id": "msup_shastadentalsupply_com",
        "schedule": "0 7 * * 0",
        "args": [
            "--max-shasta-catalog-pages=5000",
            "--product-concurrency=6",
            "--timeout-ms=45000",
        ],
    },
]


def supplier_command(supplier: dict[str, object]) -> str:
    args = [f"--supplier-id={supplier['supplier_id']}"]
    if COMMIT_ENABLED:
        args.append("--commit")
    args.extend(supplier["args"])
    arg_string = " ".join(args)

    return f"""
set -euo pipefail
cd "{BACKEND_DIR}"
if [ -f "{ENV_FILE}" ]; then
  set -a
  . "{ENV_FILE}"
  set +a
fi
export DB_SSL="${{DB_SSL:-true}}"
export NODE_OPTIONS="${{NODE_OPTIONS:---max-old-space-size=8192}}"
npm run supplier:ingest:db -- {arg_string}
""".strip()


def build_supplier_dag(supplier: dict[str, object]) -> DAG:
    with DAG(
        dag_id=f"medmkp_ingest_{supplier['name']}",
        description=f"Import the {supplier['supplier_id']} catalog and public price snapshot into MedMKP.",
        start_date=datetime(2026, 1, 1),
        schedule=supplier["schedule"],
        catchup=False,
        max_active_runs=1,
        tags=["medmkp", "supplier-ingestion", supplier["supplier_id"]],
    ) as dag:
        BashOperator(
            task_id=f"ingest_{supplier['name']}",
            bash_command=supplier_command(supplier),
            pool=POOL,
            retries=1,
        )
    return dag


for supplier in SUPPLIERS:
    globals()[f"medmkp_ingest_{supplier['name']}"] = build_supplier_dag(supplier)
