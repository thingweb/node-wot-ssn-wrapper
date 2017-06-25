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
const jsonld = require('jsonld');

/***************** Terms *****************/

rdf.environment.prefixes.set('rdf', 'http://www.w3.org/1999/02/22-rdf-syntax-ns#');
rdf.environment.prefixes.set('rdfs', 'http://www.w3.org/2000/01/rdf-schema#');
rdf.environment.prefixes.set('xsd', 'http://www.w3.org/2001/XMLSchema#');
rdf.environment.prefixes.set('owl', 'http://www.w3.org/2002/07/owl#');
rdf.environment.prefixes.set('ssn', 'http://www.w3.org/ns/ssn/');
rdf.environment.prefixes.set('sosa', 'http://www.w3.org/ns/sosa/');
rdf.environment.prefixes.set('td', 'http://www.w3.org/ns/td#');

const RDF = {
    type: rdf.environment.resolve('rdf:type')
};

const RDFS = {
    label: rdf.environment.resolve('rdfs:label')
};

const SOSA = {
    FeatureOfInterest: rdf.environment.resolve('sosa:FeatureOfInterest'),
    ObservableProperty: rdf.environment.resolve('ssn:ObservableProperty'),
    Observation: rdf.environment.resolve('sosa:Observation'),
    observedProperty: rdf.environment.resolve('sosa:observedProperty'),
    resultTime: rdf.environment.resolve('sosa:resultTime'),
    hasFeatureOfInterest: rdf.environment.resolve('sosa:hasFeatureOfInterest')
};

const TD = {
    Thing: rdf.environment.resolve('td:Thing'),
    providesInteractionPattern: rdf.environment.resolve('td:providesInteractionPattern'),
    name: rdf.environment.resolve('td:name')
}

rdf.environment.context = {
    'simpleResult': 'http://www.w3.org/ns/sosa/hasSimpleResult',
    'result': {
        '@id': 'http://www.w3.org/ns/sosa/hasResult',
        '@type': '@id'
    }
};

rdf.environment.jsonSchema = {
    type: 'object',
    oneOf: [
        {
            properties: {
                result: {
                    type: 'object'
                }
            },
            required: ['result']
        }, {
            properties: {
                simpleResult: {
                    type: ['string', 'number', 'boolean']
                }
            },
            required: ['simpleResult']
        }
    ]
};

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

rdf.Graph.prototype.toJsonLd = function() {
    var nodes = {};
    this.forEach(t => {
        var id = t.subject.toString();
        if (!nodes[id]) {
            nodes[id] = {
                '@id': id
            };
        }

        var key = t.predicate.nominalValue;
        var value = {};
        if (t.object instanceof rdf.Literal) {
            value['@value'] = t.object.toString();
            if (t.object.language) {
                value['@language'] = t.object.language;
            }
            if (t.object.datatype) {
                value['@type'] = rdf.environment.resolve(t.object.datatype);
            }
        } else { // NamedNode or BlankNode
            if (t.predicate == RDF.type) {
                key = '@type';
                value = t.object.toString();
            } else {
                value['@id'] = t.object.toString();
            }
        }

        if (value) {
            nodes[id][key] = value;
        }
    });

    var triples = [];
    for (let id in nodes) {
        triples.push(nodes[id]);
    }
    return {
        '@graph': triples
    };
}

ExposedThing.prototype.sosaInit = function(node, graph) {
    this.featureOfInterest = node;
    this.observableProperties = {};
    this.rdfGraph = graph;

    graph.match(null, SOSA.hasFeatureOfInterest, this.featureOfInterest)
         .forEach(t1 => {
             graph.match(t1.subject, SOSA.observedProperty, null)
                  .forEach(t2 => {
                      var name = gen(t2.object.nominalValue);
                      this.addProperty(name, rdf.environment.jsonSchema);
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
            var g = this.rdfGraph.toJsonLd();
            return Promise.resolve({
                then: function(resolve) {
                    jsonld.frame(g, { '@id': observation.nominalValue }, (err1, framed) => {
                        if (err1) {
                            throw new Error(err1);
                        } else {
                            let obj = framed['@graph'][0];
                            jsonld.compact(obj, rdf.environment.context, (err2, compacted) => {
                                if (err2) {
                                    throw new Error(err2);
                                } else {
                                    resolve(compacted);
                                }
                            });
                        }
                    })
                }
            });
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