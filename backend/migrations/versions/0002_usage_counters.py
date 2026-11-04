"""Usage counters for public-beta quotas (AI questions, signups).

Revision ID: 0002
Revises: 0001
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "usage_counters",
        sa.Column("key", sa.String(200), primary_key=True),
        sa.Column("count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_usage_counters_expires_at", "usage_counters", ["expires_at"])


def downgrade() -> None:
    op.drop_index("ix_usage_counters_expires_at", table_name="usage_counters")
    op.drop_table("usage_counters")
