#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
job_posting_generator.py

Generates a production‑grade Markdown job posting for the
“Senior Manager, AI Engineering” role at HackerOne.

Features
--------
* Full type annotations and dataclass usage
* Input validation (date format, email syntax, phone format)
* Structured logging with configurable level
* Graceful error handling with custom exception hierarchy
* CLI interface for easy file output
"""

from __future__ import annotations

import argparse
import logging
import re
import sys
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Iterable, Optional

# --------------------------------------------------------------------------- #
# Logging configuration
# --------------------------------------------------------------------------- #

LOG_FORMAT = (
    "%(asctime)s | %(levelname)-8s | %(name)s | %(funcName)s:%(lineno)d | %(message)s"
)
logging.basicConfig(level=logging.INFO, format=LOG_FORMAT)
logger = logging.getLogger(__name__)

# --------------------------------------------------------------------------- #
# Exceptions
# --------------------------------------------------------------------------- #

class JobPostingError(Exception):
    """Base exception for job posting errors."""


class ValidationError(JobPostingError):
    """Raised when input validation fails."""


# --------------------------------------------------------------------------- #
# Validation helpers
# --------------------------------------------------------------------------- #

EMAIL_RE = re.compile(r"^[^@]+@[^@]+\.[^@]+$")
PHONE_RE = re.compile(r"^\+?\d{1,3}[-\s]?\d{3}[-\s]?\d{3}[-\s]?\d{4}$")
DATE_FMT = "%Y-%m-%d"

def validate_email(email: str) -> None:
    if not EMAIL_RE.match(email):
        raise ValidationError(f"Invalid email address: {email!r}")


def validate_phone(phone: str) -> None:
    if not PHONE_RE.match(phone):
        raise ValidationError(f"Invalid phone number: {phone!r}")


def validate_date(date_str: str) -> None:
    try:
        datetime.strptime(date_str, DATE_FMT)
    except ValueError as exc:
        raise ValidationError(f"Date must be in {DATE_FMT} format: {date_str!r}") from exc


# --------------------------------------------------------------------------- #
# Data model
# --------------------------------------------------------------------------- #

@dataclass(frozen=True)
class ContactInfo:
    recruiter: str
    email: str
    phone: str
    linkedin: str

    def __post_init__(self) -> None:
        logger.debug("Validating ContactInfo")
        validate_email(self.email)
        validate_phone(self.phone)


@dataclass(frozen=True)
class JobPosting:
    title: str
    date: str
    location: str
    employment_type: str
    department: str
    team: str
    reporting_to: str
    contact: ContactInfo
    benefits: Iterable[str] = field(default_factory=list)

    def __post_init__(self) -> None:
        logger.debug("Validating JobPosting")
        validate_date(self.date)

    def render_markdown(self) -> str:
        logger.debug("Rendering markdown")
        benefits_md = "\n".join(f"- {b}" for b in self.benefits)
        return f"""---
title: "{self.title}"
date: {self.date}
location: "{self.location}"
type: "{self.employment_type}"
department: "{self.department}"
team: "{self.team}"
reporting_to: "{self.reporting_to}"
---

# {self.title}

HackerOne is a global leader in Continuous Threat Exposure Management (CTEM). The HackerOne Platform unites agentic AI solutions with the ingenuity of the world’s largest community of security researchers to continuously discover, validate, prioritize, and remediate exposures across code, cloud, and AI systems.

## 1. Company

- **Name** – HackerOne  
- **Industry** – Cybersecurity & threat intelligence  
- **Mission** – “Secure the world by connecting the largest community of security researchers with cutting‑edge, agentic AI solutions.”  
- **Key differentiator** – Continuous Threat Exposure Management (CTEM) that blends human ingenuity with autonomous AI.

## 2. Role

- **Title** – {self.title}  
- **Team** – {self.team}  
- **Reporting to** – {self.reporting_to}  
- **Location** – {self.location}  
- **Employment type** – {self.employment_type}  

## 3. Responsibilities

*See original posting for full details.*

## 4. Qualifications

*See original posting for full details.*

## 5. Benefits

{benefits_md}

## 6. Application Process

*See original posting for full details.*

## 7. Contact

- **Recruiter** – {self.contact.recruiter}  
- **Email** – {self.contact.email}  
- **Phone** – {self.contact.phone}  
- **LinkedIn** – {self.contact.linkedin}  

> *Note*: All contact details are placeholders; replace with the actual recruiter’s information before publishing.
"""

# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #

def parse_args(argv: Optional[Iterable[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Generate a Markdown job posting for HackerOne."
    )
    parser.add_argument(
        "--output",
        "-o",
        type=Path,
        default=Path("Senior_Manager_AI_Engineering.md"),
        help="Output file path",
    )
    parser.add_argument(
        "--log-level",
        "-l",
        default="INFO",
        choices=["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"],
        help="Logging level",
    )
    return parser.parse_args(argv)


def main(argv: Optional[Iterable[str]] = None) -> None:
    args = parse_args(argv)
    logging.getLogger().setLevel(args.log_level)

    logger.info("Creating job posting")
    contact = ContactInfo(
        recruiter="Jane Doe",
        email="jane.doe@example.com",
        phone="+1 415-555-1234",
        linkedin="https://www.linkedin.com/in/janedoe-hackerone",
    )
    posting = JobPosting(
        title="Senior Manager, AI Engineering",
        date="2026-10-17",
        location="Remote (US‑based) / HQ in San Francisco (optional)",
        employment_type="Full‑time, permanent",
        department="AI Engineering & Product",
        team="Security Operations & Platform",
        reporting_to="Director of AI & Machine Learning",
        contact=contact,
        benefits=[
            "Competitive salary + equity package",
            "Comprehensive health, dental, vision, and life insurance",
            "Generous paid time off, flexible work hours, and remote‑first culture",
            "Professional development stipend, conference travel, and hackathon support",
            "Access to HackerOne’s global community of security researchers and AI experts",
        ],
    )

    try:
        md = posting.render_markdown()
        args.output.write_text(md, encoding="utf-8")
        logger.info("Job posting written to %s", args.output)
    except (OSError, JobPostingError) as exc:
        logger.error("Failed to generate job posting: %s", exc)
        sys.exit(1)


if __name__ == "__main__":
    main()