#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
job_posting.py
~~~~~~~~~~~~~~~~
A production‑grade module for parsing, validating, and serialising job posting data.
"""

from __future__ import annotations

import json
import logging
import re
import sys
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Literal, Optional

# --------------------------------------------------------------------------- #
# Logging configuration
# --------------------------------------------------------------------------- #

_logger = logging.getLogger(__name__)
if not _logger.handlers:
    _handler = logging.StreamHandler(sys.stderr)
    _handler.setFormatter(
        logging.Formatter("[%(levelname)s] %(asctime)s %(name)s: %(message)s")
    )
    _logger.addHandler(_handler)
    _logger.setLevel(logging.INFO)

# --------------------------------------------------------------------------- #
# Type aliases
# --------------------------------------------------------------------------- #

EmploymentType = Literal[
    "Full‑time", "Part‑time", "Contract", "Internship"
]

# --------------------------------------------------------------------------- #
# Exceptions
# --------------------------------------------------------------------------- #

class JobPostingError(Exception):
    """Base exception for job posting validation errors."""
    pass


class MissingFieldError(JobPostingError):
    """Raised when a required field is missing."""
    pass


class InvalidFieldError(JobPostingError):
    """Raised when a field contains invalid data."""
    pass


# --------------------------------------------------------------------------- #
# Helper functions
# --------------------------------------------------------------------------- #

# Pre‑compiled regexes for performance
_URL_RE = re.compile(r"^https?://", re.IGNORECASE)
_LOCATION_RE = re.compile(r"^[A-Za-z0-9\s\-\.\,]+$", re.UNICODE)
_TITLE_RE = re.compile(r"^[^\s].*[^\s]$", re.UNICODE)

_MAX_LIST_LENGTH = 100
_MAX_STRING_LENGTH = 5000  # arbitrary upper bound for safety


def _parse_datetime(date_str: str) -> datetime:
    """Parse an ISO‑8601 date string into a timezone‑aware datetime."""
    try:
        dt = datetime.fromisoformat(date_str.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            _logger.debug("Assuming UTC for naive datetime %s", date_str)
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except ValueError as exc:
        _logger.error("Invalid date format: %s", date_str)
        raise InvalidFieldError(f"Invalid date format: {date_str}") from exc


def _validate_url(url: str) -> None:
    if not _URL_RE.match(url):
        _logger.error("Invalid URL: %s", url)
        raise InvalidFieldError(f"Invalid URL: {url}")


def _validate_location(location: str) -> None:
    if not _LOCATION_RE.match(location):
        _logger.error("Invalid location: %s", location)
        raise InvalidFieldError(f"Invalid location: {location}")


def _validate_string_field(name: str, value: str, max_len: int = _MAX_STRING_LENGTH) -> None:
    if not value.strip():
        _logger.error("%s cannot be empty", name)
        raise InvalidFieldError(f"{name} cannot be empty")
    if len(value) > max_len:
        _logger.error("%s exceeds maximum length (%d)", name, max_len)
        raise InvalidFieldError(f"{name} exceeds maximum length ({max_len})")


def _validate_list_field(name: str, items: Iterable[Any]) -> List[str]:
    lst = [str(item) for item in items]
    if len(lst) > _MAX_LIST_LENGTH:
        _logger.error("%s list is too long (%d items)", name, len(lst))
        raise InvalidFieldError(f"{name} list is too long ({len(lst)} items)")
    return lst


def _validate_posted_at(posted_at: datetime) -> None:
    if posted_at > datetime.now(timezone.utc):
        _logger.error("Posted date %s is in the future", posted_at)
        raise InvalidFieldError("Posted date cannot be in the future")


# --------------------------------------------------------------------------- #
# Data model
# --------------------------------------------------------------------------- #

@dataclass(frozen=True)
class JobPosting:
    """
    Immutable representation of a job posting.

    Attributes
    ----------
    title : str
        Job title.
    location : str
        Job location.
    employment_type : EmploymentType
        Type of employment.
    posted_at : datetime
        Timestamp when the job was posted.
    company : str
        Company name.
    description : str
        Full job description.
    responsibilities : List[str]
        List of responsibilities.
    qualifications : List[str]
        List of qualifications.
    benefits : List[str]
        List of benefits.
    application_url : Optional[str]
        URL for applying.
    """

    title: str
    location: str
    employment_type: EmploymentType
    posted_at: datetime
    company: str
    description: str
    responsibilities: List[str] = field(default_factory=list)
    qualifications: List[str] = field(default_factory=list)
    benefits: List[str] = field(default_factory=list)
    application_url: Optional[str] = None

    # --------------------------------------------------------------------- #
    # Construction helpers
    # --------------------------------------------------------------------- #

    @staticmethod
    def _to_list(value: Any) -> List[str]:
        if isinstance(value, list):
            return [str(v) for v in value]
        if isinstance(value, str):
            return [value]
        return []

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "JobPosting":
        """
        Create a JobPosting from a dictionary.

        Parameters
        ----------
        data : dict
            Raw data dictionary.

        Returns
        -------
        JobPosting
            Validated job posting instance.

        Raises
        ------
        MissingFieldError
            If required fields are missing.
        InvalidFieldError
            If any field contains invalid data.
        """
        required = {
            "title",
            "location",
            "employment_type",
            "posted_at",
            "company",
            "description",
        }
        missing = required - data.keys()
        if missing:
            _logger.error("Missing required fields: %s", missing)
            raise MissingFieldError(f"Missing required fields: {missing}")

        # Basic type checks
        for key in required:
            if not isinstance(data[key], str):
                _logger.error("Field %s must be a string", key)
                raise InvalidFieldError(f"Field {key} must be a string")

        # Validate and convert fields
        title = data["title"]
        location = data["location"]
        employment_type = data["employment_type"]
        posted_at = _parse_datetime(data["posted_at"])
        company = data["company"]
        description = data["description"]

        responsibilities = _to_list(data.get("responsibilities", []))
        qualifications = _to_list(data.get("qualifications", []))
        benefits = _to_list(data.get("benefits", []))
        application_url = data.get("application_url")

        # Construct instance
        instance = cls(
            title=title,
            location=location,
            employment_type=employment_type,
            posted_at=posted_at,
            company=company,
            description=description,
            responsibilities=responsibilities,
            qualifications=qualifications,
            benefits=benefits,
            application_url=application_url,
        )
        instance.validate()
        return instance

    @classmethod
    def from_json(cls, json_str: str) -> "JobPosting":
        """
        Parse a JSON string into a JobPosting.

        Parameters
        ----------
        json_str : str
            JSON representation.

        Returns
        -------
        JobPosting
        """
        try:
            data = json.loads(json_str)
        except json.JSONDecodeError as exc:
            _logger.error("JSON decoding failed: %s", exc)
            raise InvalidFieldError("Invalid JSON") from exc
        return cls.from_dict(data)

    @classmethod
    def from_file(cls, path: Path | str) -> "JobPosting":
        """
        Load a job posting from a JSON file.

        Parameters
        ----------
        path : Path | str
            Path to the JSON file.

        Returns
        -------
        JobPosting
        """
        try:
            content = Path(path).read_text(encoding="utf-8")
        except OSError as exc:
            _logger.error("Failed to read file %s: %s", path, exc)
            raise InvalidFieldError(f"Failed to read file {path}") from exc
        return cls.from_json(content)

    # --------------------------------------------------------------------- #
    # Validation
    # --------------------------------------------------------------------- #

    def validate(self) -> None:
        """
        Validate all fields of the job posting.

        Raises
        ------
        InvalidFieldError
            If any field fails validation.
        """
        _validate_string_field("title", self.title)
        _validate_string_field("company", self.company)
        _validate_string_field("description", self.description, max_len=20000)

        _validate_location(self.location)

        if self.employment_type not in {
            "Full‑time",
            "Part‑time",
            "Contract",
            "Internship",
        }:
            _logger.error("Unsupported employment type: %s", self.employment_type)
            raise InvalidFieldError(f"Unsupported employment type: {self.employment_type}")

        _validate_posted_at(self.posted_at)

        if self.application_url:
            _validate_url(self.application_url)

        self.responsibilities = _validate_list_field("responsibilities", self.responsibilities)
        self.qualifications = _validate_list_field("qualifications", self.qualifications)
        self.benefits = _validate_list_field("benefits", self.benefits)

    # --------------------------------------------------------------------- #
    # Serialisation
    # --------------------------------------------------------------------- #

    def to_dict(self) -> Dict[str, Any]:
        """
        Convert the JobPosting to a plain dictionary.

        Returns
        -------
        dict
        """
        return {
            "title": self.title,
            "location": self.location,
            "employment_type": self.employment_type,
            "posted_at": self.posted_at.isoformat(),
            "company": self.company,
            "description": self.description,
            "responsibilities": self.responsibilities,
            "qualifications": self.qualifications,
            "benefits": self.benefits,
            "application_url": self.application_url,
        }

    def to_json(self, *, indent: Optional[int] = None) -> str:
        """
        Serialise the job posting to a JSON string.

        Parameters
        ----------
        indent : int, optional
            Indentation level for pretty printing.

        Returns
        -------
        str
        """
        return json.dumps(self.to_dict(), ensure_ascii=False, indent=indent)

    # --------------------------------------------------------------------- #
    # Representation helpers
    # --------------------------------------------------------------------- #

    def __repr__(self) -> str:
        return (
            f"{self.__class__.__name__}(title={self.title!r}, "
            f"company={self.company!r}, employment_type={self.employment_type!r})"
        )

    def __str__(self) -> str:
        return f"{self.title} at {self.company} ({self.location})"


# --------------------------------------------------------------------------- #
# Public API
# --------------------------------------------------------------------------- #

__all__ = [
    "JobPosting",
    "JobPostingError",
    "MissingFieldError",
    "InvalidFieldError",
]

# --------------------------------------------------------------------------- #
# Example usage
# --------------------------------------------------------------------------- #

if __name__ == "__main__":
    sample = {
        "title": "Senior Manager, AI Engineering",
        "location": "United States (remote‑friendly)",
        "employment_type": "Full‑time",
        "posted_at": "2026-10-17T04:15:10+00:00",
        "company": "HackerOne",
        "description": (
            "Lead a high‑impact team that designs, builds, and operates AI‑driven components..."
        ),
        "responsibilities": [
            "Lead the AI Engineering team",
            "Define and own the roadmap",
        ],
        "qualifications": [
            "10+ years of software engineering experience",
            "5+ years in a leadership role",
        ],
        "benefits": [
            "Competitive salary + equity",
            "Health, dental, and vision insurance",
        ],
        "application_url": "https://jobicy.com/jobs/153461-senior-manager-ai-engineering-2",
    }

    try:
        job = JobPosting.from_dict(sample)
        _logger.info("Job posting validated: %s", job.to_dict())
    except JobPostingError as exc:
        _logger.error("Validation failed: %s", exc)