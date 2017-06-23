/*
 * The MIT License (MIT)
 * Copyright (c) 2017 Victor Charpenay & the thingweb community
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of this software
 * and associated documentation files (the "Software"), to deal in the Software without restriction,
 * including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense,
 * and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so,
 * subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all copies or substantial
 * portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED
 * TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL
 * THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
 * TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */

'use strict'

const ps = require('process');
const fs = require('fs');
const url = require('url');
const crypto = require('crypto');

const Servient = require('node-wot').Servient;
const ExposedThing = require('node-wot').ExposedThing;
const logger = require('node-wot').logger;
const HttpServer = require('node-wot').HttpServer;

const rdf = require('rdf');

/***************** Terms *****************/

rdf.environment.prefixes.set('rdf', 'http://www.w3.org/1999/02/22-rdf-syntax-ns#');
rdf.environment.prefixes.set('rdfs', 'http://www.w3.org/2000/01/rdf-schema#');
rdf.environment.prefixes.set('xsd', 'http://www.w3.org/2001/XMLSchema#');
rdf.environment.prefixes.set('owl', 'http://www.w3.org/2002/07/owl#');
rdf.environment.prefixes.set('ssn', 'http://www.w3.org/ns/ssn/');
rdf.environment.prefixes.set('sosa', 'http://www.w3.org/ns/sosa/');
rdf.environment.prefixes.set('td', 'http://www.w3.org/ns/td#');

const RDF = {
    type: rdf.environment.prefixes.resolve('rdf:type')
};

const RDFS = {
    label: rdf.environment.prefixes.resolve('rdfs:label')
};

const SOSA = {
    FeatureOfInterest: rdf.environment.prefixes.resolve('sosa:FeatureOfInterest'),
    ObservableProperty: rdf.environment.prefixes.resolve('ssn:ObservableProperty'),
    Observation: rdf.environment.prefixes.resolve('sosa:Observation'),
    observedProperty: rdf.environment.prefixes.resolve('sosa:observedProperty'),
    resultTime: rdf.environment.prefixes.resolve('sosa:resultTime'),
    hasFeatureOfInterest: rdf.environment.prefixes.resolve('sosa:hasFeatureOfInterest')
};

const SSN = {
    Property: rdf.environment.prefixes.resolve('ssn:Property')
}

const TD = {
    Thing: rdf.environment.prefixes.resolve('td:Thing'),
    providesInteractionPattern: rdf.environment.prefixes.resolve('td:providesInteractionPattern'),
    name: rdf.environment.prefixes.resolve('td:name')
}

/***************** Functions *****************/

function gen(obj) {
    const hash = crypto.createHash('sha1');
    hash.update(obj.toString());
    let val = hash.digest('hex');
    return val.substring(0, 6);
}

rdf.Graph.prototype.matchFirst = function(s, p, o) {
    // note: rdf.Graph implemented as Array
    var triples = this.match();
    if (triples) {
        return triples[0];
    } else {
        return undefined;
    }
};

ExposedThing.prototype.sosaInit = function(node, graph) {
    this.featureOfInterest = node;
    this.observableProperties = {};
    this.rdfGraph = graph;

    graph.match(null, SOSA.hasFeatureOfInterest, this.featureOfInterest)
         .forEach(t1 => {
             graph.match(t1.subject, SOSA.observedProperty, null)
                  .forEach(t2 => {
                      var name = gen(t2.object.nominalValue);
                      this.addProperty(name, {type: 'string'});
                      this.observableProperties[name] = t2.object;
                  });
         });
}

const superImpl = ExposedThing.prototype.getProperty;
ExposedThing.prototype.getProperty = function(name) {
    var p = this.observableProperties[name];
    if (p) {
        // retrieve latest Observation
        var observation = null;
        var lastTime = new Date(0);
        this.rdfGraph.match(null, SOSA.observedProperty, p)
                     .forEach(t => {
                         var resultTime = this.rdfGraph.matchFirst(t.subject, SOSA.resultTime, null);
                         if (!observation || resultTime > lastTime) {
                             observation = t.subject;
                         }
                     });
        if (observation) {
            return Promise.resolve(observation);
        } else {
            return Promise.reject(new Error('No observation for property ' + this.name));
        }
    } else {
        superImpl(name);
    }
}

// TODO setProperty -> add new Observation

/***************** Application *****************/

var f = ps.argv[2];
if (!f) {
    console.log('Usage: node ssn-wrapper.js <file>\n' +
                'Params:\n' +
                '\tfile - RDF file (Turtle)');
    return;
}
var text = fs.readFileSync(f, 'UTF-8');

let servient = new Servient();
servient.addServer(new HttpServer());
let WoT = servient.start();

var parser = new rdf.TurtleParser();
parser.parse(text, function(graph) {
    graph.match(null, RDF.type, SOSA.FeatureOfInterest)
         .forEach(t => {
            var name = gen(t.subject.nominalValue);
            WoT.createThing(name)
               .then(thing => {
                   thing.sosaInit(t.subject, graph);
               });
         });
});