from fastapi.templating import Jinja2Templates


def _inr(value, decimals: int = 0) -> str:
    """Indian-grouping rupee format. e.g. 1234567.5 -> '₹12,34,568' (decimals=0) or '₹12,34,567.50' (decimals=2)."""
    if value is None or value == "":
        return "—"
    try:
        n = float(value)
    except (TypeError, ValueError):
        return str(value)

    negative = n < 0
    n = abs(n)

    if decimals:
        s = f"{n:.{decimals}f}"
        int_part, _, frac_part = s.partition(".")
    else:
        int_part = f"{n:.0f}"
        frac_part = ""

    if len(int_part) > 3:
        last_three = int_part[-3:]
        rest = int_part[:-3]
        groups = []
        while len(rest) > 2:
            groups.insert(0, rest[-2:])
            rest = rest[:-2]
        if rest:
            groups.insert(0, rest)
        int_part = ",".join(groups) + "," + last_three

    result = f"₹{int_part}"
    if frac_part:
        result += f".{frac_part}"
    return ("-" + result) if negative else result


def _heatmap(value, vmin, vmax, alpha_max: float = 0.4) -> str:
    """Return a CSS `background-color: rgba(...)` declaration scaling green for
    positive values (toward vmax) and red for negative (toward vmin). Zero is
    no colour. vmin is the most-negative value in the column, vmax the most-positive."""
    if value is None:
        return ""
    try:
        v = float(value)
    except (TypeError, ValueError):
        return ""
    if v > 0 and vmax and vmax > 0:
        intensity = min(1.0, v / vmax)
        return f"background-color: rgba(34, 139, 34, {intensity * alpha_max:.3f})"
    if v < 0 and vmin and vmin < 0:
        intensity = min(1.0, v / vmin)
        return f"background-color: rgba(200, 50, 50, {intensity * alpha_max:.3f})"
    return ""


class _PatchedTemplates(Jinja2Templates):
    def TemplateResponse(self, name, context=None, **kwargs):
        if context and "request" in context:
            request = context.pop("request")
            return super().TemplateResponse(request, name, context, **kwargs)
        return super().TemplateResponse(name, context, **kwargs)


templates = _PatchedTemplates(directory="app/templates")
templates.env.filters["inr"] = _inr
templates.env.filters["heatmap"] = _heatmap
