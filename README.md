# noto-builder

This package is designed to generate NPM packages containing woff2 compressed versions of the Noto fonts, for use in browser applications.

In addition to gathering the font files into an NPM package, CSS is also generated for each font variant in the form:

```
fontname-stretch-weight.css
```

For example, the CSS for the Noto Sans Mono font, in condensed form, with a weight of 300 is:

```
noto-sans-mono-condensed-300.css
```

Currently, the following stretch values are used by Noto:
- `condensed`
- `extra-condensed`
- `normal`
- `semi-condensed`

Weights are 100 - 900, in increments of 100.

Convenience files which import all of the weights for a particular stretch, are provided in the form `fontname-stretch.css`.

Finally, a CSS file which import all of the `fontname-stretch.css` files is included, as `fontname.css`.

## Building an running

To run the typescript compiler, run `npm run build`.

To build the font packages, run `npm run run`.