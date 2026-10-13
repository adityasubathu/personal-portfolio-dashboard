"""Regression tests for the asset-class targets save — statement compiled, no DB required."""
from sqlalchemy.dialects import postgresql

from app.models.allocation_target import AllocationTarget
from app.services.allocation import _foreign_target_upsert


def compiled(stmt):
    return stmt.compile(dialect=postgresql.dialect())


class TestForeignTargetUpsert:
    def test_conflict_target_matches_category_mode_unique_constraint(self):
        assert "ON CONFLICT (category, alloc_mode) DO UPDATE" in str(compiled(_foreign_target_upsert(12.5)))

    def test_conflict_columns_exist_as_unique_constraint_on_model(self):
        unique_column_sets = {
            tuple(col.name for col in c.columns)
            for c in AllocationTarget.__table__.constraints
            if c.__class__.__name__ == "UniqueConstraint"
        }
        assert ("category", "alloc_mode") in unique_column_sets

    def test_writes_anchored_foreign_row(self):
        params = compiled(_foreign_target_upsert(12.5)).params
        assert params["category"] == "Equity - Foreign"
        assert params["alloc_mode"] == "anchored"
        assert params["target_pct"] == 12.5
