"""Grade formula for the ECON315 game theory course.

The 30% component is:

    component = min(100, (1/3 * midterm + 2/3 * final) * (1 + bonus / 100))

where midterm and final are out of 100 and bonus is a percentage
(10 bonus points -> multiply by 1.10).
"""

from __future__ import annotations

import re
from dataclasses import dataclass

CAP = 100.0
COMPONENT_WEIGHT = 0.30
MIDTERM_WEIGHT = 0.30
FINAL_WEIGHT = 0.40

USAGE = (
    "Usage: /score <midterm> <final> [bonus]\n"
    "Example: /score 72 85 10\n"
    "Midterm and final are out of 100; bonus is in % (10 means x1.10)."
)


class InputError(ValueError):
    """Raised when the user's numbers can't be used."""


@dataclass(frozen=True)
class Result:
    midterm: float
    final: float
    bonus: float
    weighted: float  # 1/3 midterm + 2/3 final, before bonus
    component: float  # the 30% component, out of 100 (capped)
    capped: bool

    @property
    def component_points(self) -> float:
        """Contribution of the component to the course grade, out of 30."""
        return self.component * COMPONENT_WEIGHT

    @property
    def course_total(self) -> float:
        """Estimated course grade: 30% midterm + 40% final + 30% component."""
        return (
            self.midterm * MIDTERM_WEIGHT
            + self.final * FINAL_WEIGHT
            + self.component_points
        )


def compute(midterm: float, final: float, bonus: float = 0.0) -> Result:
    for name, value in (("Midterm", midterm), ("Final", final)):
        if not 0 <= value <= 100:
            raise InputError(f"{name} must be between 0 and 100 (got {fmt(value)}).")
    if not 0 <= bonus <= 100:
        raise InputError(f"Bonus must be between 0 and 100 % (got {fmt(bonus)}).")

    weighted = midterm / 3 + 2 * final / 3
    boosted = weighted * (1 + bonus / 100)
    return Result(
        midterm=midterm,
        final=final,
        bonus=bonus,
        weighted=weighted,
        component=min(CAP, boosted),
        capped=boosted > CAP,
    )


_NUMBER = re.compile(r"^[+-]?(\d+([.,]\d*)?|[.,]\d+)%?$")


def parse_args(text: str) -> tuple[float, float, float]:
    """Parse "72 85 10" (bonus optional). Accepts decimal commas and a % sign."""
    parts = text.replace(";", " ").split()
    if len(parts) not in (2, 3):
        raise InputError(USAGE)
    numbers = []
    for part in parts:
        if not _NUMBER.match(part):
            raise InputError(f"'{part}' is not a number.\n\n{USAGE}")
        numbers.append(float(part.rstrip("%").replace(",", ".")))
    if len(numbers) == 2:
        numbers.append(0.0)
    return numbers[0], numbers[1], numbers[2]


def fmt(x: float) -> str:
    return f"{x:.2f}".rstrip("0").rstrip(".")


def format_result(r: Result) -> str:
    lines = [
        f"Midterm {fmt(r.midterm)}, final {fmt(r.final)}, bonus {fmt(r.bonus)}%",
        f"1/3 x midterm + 2/3 x final = {fmt(r.weighted)}",
    ]
    if r.bonus:
        lines.append(
            f"x {fmt(1 + r.bonus / 100)} (bonus) = {fmt(r.weighted * (1 + r.bonus / 100))}"
            + (" -> capped at 100" if r.capped else "")
        )
    lines += [
        "",
        f"30% component: {fmt(r.component)} / 100",
        f"= {fmt(r.component_points)} / 30 points of the course grade",
        "",
        f"Estimated course total: {fmt(r.course_total)} / 100",
        "(30% midterm + 40% final + 30% component)",
    ]
    return "\n".join(lines)


def answer(text: str) -> str:
    """Turn the arguments of a /score command into a reply."""
    try:
        return format_result(compute(*parse_args(text)))
    except InputError as e:
        return str(e)
