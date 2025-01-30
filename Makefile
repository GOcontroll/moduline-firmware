DESTDIR?=/lib/

install:
	@install -Dm644 -t $(DESTDIR)/lib/firmware/brcm/ firmware/brcm/*
	@install -Dm644 -t $(DESTDIR)/lib/firmware/gocontroll firmware/gocontroll/*

