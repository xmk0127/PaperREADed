PYTHON ?= python3

.PHONY: setup install doctor start install-frontend install-backend lint test test-launcher build check smoke bundle

setup install:
	$(PYTHON) scripts/project.py setup

doctor:
	$(PYTHON) scripts/project.py doctor

start:
	$(PYTHON) scripts/project.py start

install-frontend:
	npm --prefix frontend ci

install-backend:
	cd backend && $(PYTHON) -m venv .venv
	cd backend && .venv/bin/python -m pip install --no-deps -r requirements.lock
	cd backend && .venv/bin/python -m pip install --no-deps --no-build-isolation -e ".[dev]"
	cd backend && .venv/bin/python -m pip check

lint:
	npm --prefix frontend run lint

test: test-launcher
	cd backend && .venv/bin/python -m pytest
	npm --prefix frontend run test -- --maxWorkers=1

test-launcher:
	$(PYTHON) -m unittest discover -s scripts/tests -v

build:
	npm --prefix frontend run build

check: lint test build

smoke:
	$(PYTHON) scripts/smoke.py

bundle:
	$(PYTHON) scripts/release_bundle.py
