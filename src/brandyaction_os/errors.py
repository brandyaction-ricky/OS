from __future__ import annotations


class BAError(Exception):
    """Expected domain error rendered without a Python traceback."""

    def __init__(
        self,
        code: str,
        message: str,
        *,
        hint: str | None = None,
        exit_code: int = 1,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.hint = hint
        self.exit_code = exit_code

    def render(self) -> str:
        result = f"[{self.code}] {self.message}"
        if self.hint:
            result += f"\n해결: {self.hint}"
        return result

