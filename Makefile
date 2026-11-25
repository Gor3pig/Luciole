UUID    := luciole@luciole.dev
SRC     := src
DIST    := dist
SCHEMA  := schemas/org.gnome.shell.extensions.luciole.gschema.xml

# Every source directory of the extension except those pack handles itself.
DIRS    := $(patsubst $(SRC)/%/,%,$(wildcard $(SRC)/*/))
# Files beyond the ones pack picks up by itself (metadata.json, extension.js, prefs.js,
# stylesheet.css, schemas, po): the dark stylesheet and every source directory.
EXTRA   := stylesheet-dark.css $(filter-out schemas po,$(DIRS))
PACK_ARGS := --force --out-dir=$(DIST) --schema=$(SCHEMA) \
	$(foreach d,$(EXTRA),--extra-source=$(d)) \
	$(if $(wildcard $(SRC)/po),--podir=po)

.PHONY: help check lint test schemas pack shell-test shell-test-ui shell-test-search capture clean

help:
	@echo "make check       lint + unit tests"
	@echo "make lint        ESLint"
	@echo "make test        unit tests (plain gjs, no shell needed)"
	@echo "make schemas     compile GSettings schemas for local runs"
	@echo "make pack        build $(DIST)/$(UUID).shell-extension.zip"
	@echo "make shell-test  enable/disable cycles in a headless shell (CYCLES=100)"
	@echo "make shell-test-ui  open/close the launcher with its shortcut (CYCLES=150)"
	@echo "make shell-test-search  search, activation, history and installs with test apps"
	@echo "make capture     PNG screenshots of the launcher, light and dark, in _local/captures"

check: lint test

lint:
	npx eslint .

test:
	gjs -m tests/run.js

schemas:
	glib-compile-schemas $(SRC)/schemas

pack: schemas
	@# gnome-extensions 51.1 crashes (SIGSEGV) instead of reporting an error when --out-dir does not exist.
	mkdir -p $(DIST)
	gnome-extensions pack $(PACK_ARGS) $(SRC)

shell-test: schemas
	sh tests/shell/cycle.sh $(or $(CYCLES),100)

shell-test-ui: schemas
	sh tests/shell/openclose.sh $(or $(CYCLES),150)

shell-test-search: schemas
	sh tests/shell/search.sh

capture: schemas
	sh tests/shell/capture.sh _local/captures/launcher-light.png light open
	sh tests/shell/capture.sh _local/captures/launcher-dark.png dark open

clean:
	rm -rf $(DIST) $(SRC)/schemas/gschemas.compiled
