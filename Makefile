UUID    := luciole@luciole.dev
SRC     := src
DIST    := dist
SCHEMA  := schemas/org.gnome.shell.extensions.luciole.gschema.xml

# Every source directory of the extension except those pack handles itself.
DIRS    := $(patsubst $(SRC)/%/,%,$(wildcard $(SRC)/*/))
# Files beyond the ones pack picks up by itself (metadata.json, extension.js, prefs.js,
# stylesheet.css, schemas, po): the dark stylesheet and every source directory.
# Translations are compiled by pack itself from src/po; src/locale is for local runs only.
EXTRA   := stylesheet-dark.css $(filter-out schemas po locale,$(DIRS))
PACK_ARGS := --force --out-dir=$(DIST) --schema=$(SCHEMA) \
	$(foreach d,$(EXTRA),--extra-source=$(d)) \
	$(if $(wildcard $(SRC)/po),--podir=po)

POT     := $(SRC)/po/luciole.pot
LANGS   := $(patsubst $(SRC)/po/%.po,%,$(wildcard $(SRC)/po/*.po))

.PHONY: help check lint test schemas pot po locale pack shell-test shell-test-ui shell-test-search shell-test-degrade shell-test-files capture clean

help:
	@echo "make check       lint + unit tests"
	@echo "make lint        ESLint"
	@echo "make test        unit tests (plain gjs, no shell needed)"
	@echo "make schemas     compile GSettings schemas for local runs"
	@echo "make pot         extract the texts to translate into src/po/luciole.pot"
	@echo "make po          update every src/po/<language>.po from the template"
	@echo "make locale      compile the translations for local runs (src/locale)"
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

shell-test-degrade: schemas
	sh tests/shell/degrade.sh

shell-test-files: schemas
	sh tests/shell/files.sh

capture: schemas
	sh tests/shell/capture.sh _local/captures/launcher-light.png light open
	sh tests/shell/capture.sh _local/captures/launcher-dark.png dark open

clean:
	rm -rf $(DIST) $(SRC)/schemas/gschemas.compiled
