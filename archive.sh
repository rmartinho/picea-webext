#!/bin/bash

cd dist
zip -r -FS ../../picea.zip *
cd ..
zip -r -FS ../picea.src.zip *.ts manifest.json package.json yarn.lock README icons/ res/ 
