#!/bin/bash

cd dist
zip -r -FS ../../clarkesreader.zip * --exclude *.map
cd ..
zip -r -FS ../clarkesreader.src.zip index.ts manifest.json package.json yarn.lock README icons/ resources/ 
