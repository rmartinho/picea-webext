#!/bin/bash

cd dist; zip -r -FS ../../clarkesreader.zip * --exclude *.map; cd ..; zip -r -FS ../clarkesreader.src.zip index.ts icons/ resources/ manifest.json package.json README yarn.lock
