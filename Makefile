# SPDX-FileCopyrightText: 2026 Luciole contributors
# SPDX-License-Identifier: GPL-2.0-or-later

UUID    := luciole@gor3pig.github.io
SRC     := src
DIST    := dist
SCHEMA  := schemas/org.gnome.shell.extensions.luciole.gschema.xml

# Every source directory of the extension except those pack handles itself.
DIRS    := $(patsubst $(SRC)/%/,%,$(wildcard $(SRC)/*/))
# Files beyond the ones pack picks up by itself (metadata.json, extension.js, prefs.js,
# stylesheet.css, schemas, po): the dark stylesheet and every source directory.
# Translations are compiled by pack itself from src/po; src/locale is for local runs only.
# The icon shown in the preferences (a copy of the 128 px one from data/icons, see `make icon`).
ICON    := luciole-128x128.png
EXTRA   := stylesheet-dark.css $(ICON) $(filter-out schemas po locale,$(DIRS))
PACK_ARGS := --force --out-dir=$(DIST) --schema=$(SCHEMA) \
	$(foreach d,$(EXTRA),--extra-source=$(d)) \
	$(if $(wildcard $(SRC)/po),--podir=po)

POT     := $(SRC)/po/luciole.pot
LANGS   := $(patsubst $(SRC)/po/%.po,%,$(wildcard $(SRC)/po/*.po))

.PHONY: help check lint test fuzz mutation soak zipcheck gate gate-push gate-full test-gnome50 schemas pot po locale icon assets pack shell-test shell-test-ui shell-test-search shell-test-degrade shell-test-files capture clean

help:
	@echo "make check       lint + unit tests"
	@echo "make lint        ESLint"
	@echo "make gate        the quality gate, quick: changed lines' mutants, shell tests side by side"
	@echo "make gate-push   the quality gate before a push: every mutant of what changed since the last push"
	@echo "make gate-full   the quality gate at the end of a lot: every mutant, longer cycles"
	@echo "make test-gnome50  the tests on GNOME Shell 50, in a podman container (nothing installed on the host)"
	@echo "make fuzz        random-data tests, fixed seeds (replay one with LUCIOLE_SEED=n)"
	@echo "make mutation    break the code on purpose; the tests must notice (all mutants)"
	@echo "make soak        thousands of random actions in a headless shell (endurance)"
	@echo "make zipcheck    build the package and check its content"
	@echo "make test        unit tests (plain gjs, no shell needed)"
	@echo "make schemas     compile GSettings schemas for local runs"
	@echo "make pot         extract the texts to translate into src/po/luciole.pot"
	@echo "make po          update every src/po/<language>.po from the template"
	@echo "make locale      compile the translations for local runs (src/locale)"
	@echo "make icon        copy the 128 px icon into src for local runs and for the package"
	@echo "make assets      locale and icon: everything a local run needs"
	@echo "make pack        build $(DIST)/$(UUID).shell-extension.zip"
	@echo "make shell-test  enable/disable cycles in a headless shell (CYCLES=100)"
	@echo "make shell-test-ui  open/close the launcher with its shortcut (CYCLES=150)"
	@echo "make shell-test-search  search, activation, history and installs with test apps"
	@echo "make shell-test-degrade  files enabled but the index service missing"
	@echo "make shell-test-files  file results through a stand-in index on the test bus"
	@echo "make capture     PNG screenshots of the launcher, light and dark, in _local/captures"

check: lint test

lint:
	npx eslint .

test:
	gjs -m tests/run.js

fuzz:
	@for seed in 1 2 3; do echo "seed $$seed"; LUCIOLE_SEED=$$seed gjs -m tests/run.js --fuzz | tail -n 1 || exit 1; done

mutation:
	gjs -m tests/mutation/run.js

soak: schemas
	sh tests/shell/soak.sh

zipcheck:
	sh tests/zipcheck.sh

gate:
	sh tests/gate.sh

gate-push:
	GATE_PUSH=1 sh tests/gate.sh

gate-full:
	GATE_FULL=1 sh tests/gate.sh

test-gnome50:
	sh tests/container/run.sh --capture

schemas:
	glib-compile-schemas $(SRC)/schemas

pot:
	mkdir -p $(SRC)/po
	xgettext --from-code=UTF-8 --language=JavaScript --keyword=_ --add-comments=Translators \
		--add-location=file --package-name=luciole --msgid-bugs-address= \
		-o $(POT) $$(find $(SRC) -name '*.js' -not -path '$(SRC)/locale/*' | sort)

po: pot
	for lang in $(LANGS); do msgmerge --update --backup=none --quiet $(SRC)/po/$$lang.po $(POT); done

locale:
	for lang in $(LANGS); do \
		mkdir -p $(SRC)/locale/$$lang/LC_MESSAGES; \
		msgfmt --check --output-file=$(SRC)/locale/$$lang/LC_MESSAGES/luciole.mo $(SRC)/po/$$lang.po; \
	done

icon:
	cp data/icons/$(ICON) $(SRC)/$(ICON)

assets: locale icon

pack: schemas icon
	@# gnome-extensions 51.1 crashes (SIGSEGV) instead of reporting an error when --out-dir does not exist.
	mkdir -p $(DIST)
	gnome-extensions pack $(PACK_ARGS) $(SRC)

shell-test: schemas
	sh tests/shell/cycle.sh $(or $(CYCLES),100)

shell-test-ui: schemas
	sh tests/shell/openclose.sh $(or $(CYCLES),150)

shell-test-search: schemas
	sh tests/shell/search.sh

shell-test-degrade: schemas
	sh tests/shell/degrade.sh

shell-test-files: schemas
	sh tests/shell/files.sh

capture: schemas
	sh tests/shell/capture.sh _local/captures/launcher-light.png light open
	sh tests/shell/capture.sh _local/captures/launcher-dark.png dark open

clean:
	rm -rf $(DIST) $(SRC)/schemas/gschemas.compiled $(SRC)/$(ICON)
