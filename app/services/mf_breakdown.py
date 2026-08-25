# Re-export shim — keeps existing router imports working after the split.
# Logic lives in mf_ingest.py, allocation.py, and composition.py.
from app.services.mf_ingest import (
    normalize_company_name,
    ingest_from_openfin,
    sync_amfi_market_cap,
)
from app.services.allocation import (
    get_allocation_comparison,
    get_allocation_targets,
    get_asset_class_comparison,
    get_asset_class_targets,
    get_breakdown_chart_data,
    get_rebalance_plan,
    get_stock_holdings_table,
    save_allocation_targets,
    save_asset_class_targets,
)
from app.services.composition import (
    get_available_schemes,
    get_category_composition,
    get_direct_trade_breakdown,
    get_scheme_breakdown,
    get_sector_composition,
    get_sector_list,
    get_sector_stock_breakdown,
    save_sector_overrides,
)

__all__ = [
    "normalize_company_name",
    "ingest_from_openfin",
    "sync_amfi_market_cap",
    "get_allocation_comparison",
    "get_allocation_targets",
    "get_asset_class_comparison",
    "get_asset_class_targets",
    "get_breakdown_chart_data",
    "get_rebalance_plan",
    "get_stock_holdings_table",
    "save_allocation_targets",
    "save_asset_class_targets",
    "get_available_schemes",
    "get_category_composition",
    "get_direct_trade_breakdown",
    "get_scheme_breakdown",
    "get_sector_composition",
    "get_sector_list",
    "get_sector_stock_breakdown",
    "save_sector_overrides",
]
