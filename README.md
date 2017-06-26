# Getting started

Requirement: https://github.com/thingweb/node-wot

To install `node-wot`:
```shell
$ git clone https://github.com/thingweb/node-wot
$ cd node-wot
$ npm install
$ npm run build
$ npm run test # optional
$ sudo npm run link
```

To install `node-wot-ssn-wrapper`
```shell
$ cd node-wot-ssn-wrapper
$ npm link node-wot
$ npm install
```

To start with an example:
```
$ node src/ssn-wrapper.js examples/tree-height.ttl examples/tree-height.jsonld
```

# Troubleshoot

If the installation of `node-wot` throws error, try updating node.js to the latest LTS (6.11). 